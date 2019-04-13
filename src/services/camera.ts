import { service, inject } from 'spryly';
import { Server } from 'hapi';
import * as request from 'request';
import { EventEmitter } from 'events';
import * as _get from 'lodash.get';
import { promisify } from 'util';
import { exec } from 'child_process';
import { platform as osPlatform } from 'os';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { FileHandlerService } from './fileHandler';
import { StateService } from './state';
import { ICameraResult } from './clientTypes';
import { InferenceProcessorService } from '../services/inferenceProcessor';
import { IoTCentralService, MeasurementType, DeviceState, DeviceEvent, DeviceSetting, DeviceProperty } from '../services/iotcentral';
import { bind, sleep, forget } from '../utils';

const defaultCameraUsername: string = 'admin';
const defaultCameraPassword: string = 'admin';
const defaultresolutionSelectVal: number = 1;
const defaultencodeModeSelectVal: number = 1;
const defaultbitRateSelectVal: number = 3;
const defaultfpsSelectVal: number = 1;
const defaultMaxLoginAttempts: number = 4;
const defaultRtspVideoPort: string = '8900';
const defaultIpcPort: string = '1080';

@service('camera')
export class CameraService extends EventEmitter {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    @inject('fileHandler')
    private fileHandler: FileHandlerService;

    @inject('state')
    private state: StateService;

    @inject('inferenceProcessor')
    private inferenceProcessor: InferenceProcessorService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private cameraUserName: string = defaultCameraUsername;
    private cameraPassword: string = defaultCameraPassword;
    private maxLoginAttempts: number = defaultMaxLoginAttempts;
    private rtspVideoPort: string = defaultRtspVideoPort;
    private ipAddresses: any = {
        cameraIpAddress: '127.0.0.1',
        hostIpAddress: '127.0.0.1'
    };
    private sessionToken: string = '';
    private ipcPort: string = defaultIpcPort;
    private rtspVideoUrl: string = '';
    private rtspVamUrl: string = '';
    private resolutions: string[] = [];
    private encoders: string[] = [];
    private bitRates: string[] = [];
    private frameRates: number[] = [];
    private videoSettings = {
        resolutionSelectVal: defaultresolutionSelectVal,
        encodeModeSelectVal: defaultencodeModeSelectVal,
        bitRateSelectVal: defaultbitRateSelectVal,
        fpsSelectVal: defaultfpsSelectVal,
        displayOut: 0
    };
    private modelFiles: string[] = [];
    private videoPreview: boolean = false;
    private vamProcessing: boolean = false;

    public get currentResolutionSelectVal() {
        return this.videoSettings.resolutionSelectVal;
    }

    public get currentEncodeModeSelectVal() {
        return this.videoSettings.encodeModeSelectVal;
    }

    public get currentBitRateSelectVal() {
        return this.videoSettings.bitRateSelectVal;
    }

    public get currentFpsSelectVal() {
        return this.videoSettings.fpsSelectVal;
    }

    public get currentDisplayOutVal() {
        return this.videoSettings.displayOut;
    }

    public async init(): Promise<void> {
        this.logger.log(['CameraService', 'info'], 'initialize');

        this.cameraUserName = this.config.get('cameraUsername') || defaultCameraUsername;
        this.cameraPassword = this.config.get('cameraPassword') || defaultCameraPassword;
        this.maxLoginAttempts = this.config.get('maxLoginAttemps') || defaultMaxLoginAttempts;
        this.rtspVideoPort = this.config.get('rtspVideoPort') || defaultRtspVideoPort;
        this.ipcPort = this.config.get('ipcPort') || defaultIpcPort;

        this.server.decorate('server', 'startCamera', this.startCamera);
    }

    @bind
    public async startCamera(): Promise<void> {
        await this.login();
    }

    public async login(): Promise<ICameraResult> {
        let status = false;

        try {
            if (this.sessionToken) {
                this.logger.log(['CameraService', 'info'], `Logging out of existing session (${this.sessionToken})`);

                await this.logout();
            }

            this.ipAddresses = await this.getWlanIp();

            this.logger.log(['CameraService', 'info'], `Logging into new session`);

            status = await this.ipcLogin();

            if (status === true) {
                status = await this.initializeCamera();
            }
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);
        }

        if (status === false) {
            this.logger.log(['CameraService', 'error'], `Error during initialization, logging out`);

            const result = await this.logout();
            return {
                ...result,
                status,
                title: 'Login',
                message: `An error occurred while creating a new camera session. Try rebooting the device and login again.`
            };
        }
        else {
            forget(this.iotCentral.sendMeasurement, MeasurementType.Event, { [DeviceEvent.SessionLogin]: this.sessionToken });

            return {
                ...this.getConfiguration(),
                title: 'Login'
            };
        }
    }

    public async logout(): Promise<ICameraResult> {
        let status = false;

        try {
            this.inferenceProcessor.stopInferenceProcessor();

            if (this.sessionToken) {
                for (let iLogoutAttempts = 0; status === false && iLogoutAttempts < 3; ++iLogoutAttempts) {
                    try {
                        status = await this.ipcPostRequest('/logout', {});
                        break;
                    }
                    catch (ex) {
                        if (ex.code !== 'ESOCKETTIMEDOUT') {
                            throw new Error(ex);
                        }
                    }
                }

                forget(this.iotCentral.sendMeasurement, MeasurementType.Event, { [DeviceEvent.SessionLogout]: this.sessionToken });
            }

            status = true;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            status = false;
        }

        this.sessionToken = '';
        this.videoPreview = false;
        this.rtspVideoUrl = '';
        this.vamProcessing = false;
        this.rtspVamUrl = '';

        return {
            ...this.getConfiguration(),
            status,
            title: 'Logout'
        };
    }

    public getConfiguration(): ICameraResult {
        return {
            status: true,
            title: 'Camera',
            message: 'Succeeded',
            body: {
                deviceConfig: {
                    sessionToken: this.sessionToken,
                    ipAddresses: this.ipAddresses,
                    rtspVideoUrl: this.sessionToken ? this.rtspVideoUrl : '',
                    rtspVamUrl: this.sessionToken ? this.rtspVamUrl : '',
                    resolution: this.sessionToken ? this.resolutions[this.videoSettings.resolutionSelectVal] : '',
                    resolutions: this.resolutions,
                    encoder: this.sessionToken ? this.encoders[this.videoSettings.encodeModeSelectVal] : '',
                    encoders: this.encoders,
                    bitRate: this.sessionToken ? this.bitRates[this.videoSettings.bitRateSelectVal] : '',
                    bitRates: this.bitRates,
                    frameRate: this.sessionToken ? this.frameRates[this.videoSettings.fpsSelectVal] : '',
                    frameRates: this.frameRates,
                    modelFiles: this.modelFiles,
                    videoPreview: this.videoPreview,
                    vamProcessing: this.vamProcessing
                },
                iotcConfig: {
                    systemName: this.state.system.systemName,
                    systemId: this.state.system.systemId,
                    deviceId: this.state.iotCentral.deviceId,
                    scopeId: this.iotCentral.iotCentralScopeId,
                    deviceKey: this.state.iotCentral.deviceKey,
                    templateId: this.iotCentral.iotCentralTemplateId,
                    templateVersion: this.iotCentral.iotCentralTemplateVersion,
                    iotCentralHubConnectionString: this.iotCentral.iotCentralHubConnectionString,
                    iotCentralProvisioningStatus: this.iotCentral.iotCentralProvisioningStatus,
                    iotCentralConnectionStatus: this.iotCentral.iotCentralConnectionStatus
                }
            }
        };
    }

    public async changeModel(file: any): Promise<ICameraResult> {
        let status = false;

        try {
            status = await this.fileHandler.uploadAndVerifyModelFiles(file);

            if (status === true) {
                await this.logout();

                status = await this.fileHandler.changeModelFiles(file);
            }

            if (status === true) {
                const result = await this.login();
                status = result.status;
            }

            if (status === true) {
                this.server.publish('/api/v1/subscription/model', this.modelFiles);
            }
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            status = false;
        }

        return {
            status,
            title: 'Camera',
            message: status
                ? 'Succeeded'
                : 'An error occurred while updating your vision model files'
        };
    }

    public async togglePreview(switchStatus: boolean): Promise<ICameraResult> {
        let status;

        try {
            status = await this.ipcPostRequest('/preview', { switchStatus });
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            status = false;
        }

        return {
            status,
            title: 'Camera',
            message: status ? 'Succeeded' : `The attempt to switch ${status ? 'on' : 'off'} the video output didn't complete successfully.`
        };
    }

    public async toggleVam(switchStatus: boolean): Promise<boolean> {
        try {
            return this.ipcPostRequest('/vam', { switchStatus, vamconfig: 'MD' });
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async toggleOverlay(status): Promise<boolean> {
        try {
            return this.ipcPostRequest('/overlay', { switchStatus: status });
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async configureDisplayOut(videoSettings): Promise<boolean> {
        const payload = {
            resolutionSelectVal: (videoSettings.resolutionSelectVal < this.resolutions.length) ? videoSettings.resolutionSelectVal : this.videoSettings.resolutionSelectVal,
            encodeModeSelectVal: (videoSettings.encodeModeSelectVal < this.encoders.length) ? videoSettings.encodeModeSelectVal : this.videoSettings.encodeModeSelectVal,
            bitRateSelectVal: (videoSettings.bitRateSelectVal < this.bitRates.length) ? videoSettings.bitRateSelectVal : this.videoSettings.bitRateSelectVal,
            fpsSelectVal: (videoSettings.fpsSelectVal < this.frameRates.length) ? videoSettings.fpsSelectVal : this.videoSettings.fpsSelectVal,
            displayOut: videoSettings.displayOut
        };

        try {
            const result = await this.ipcPostRequest('/video', payload);

            this.videoSettings = {
                ...payload
            };

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async configureOverlay(type: string, text?: string): Promise<boolean> {
        if (type === 'inference') {
            return this.configureInferenceOverlay();
        }
        else if (type === 'text') {
            return this.configureTextOverlay(text);
        }

        this.logger.log(['CameraService', 'error'], 'Invalid overlay type use (inference/text)');
        return Promise.resolve(false);
    }

    public async captureImage(): Promise<any> {
        return this.ipcPostRequest('/captureimage', {});
    }

    private async initializeCamera(): Promise<boolean> {
        this.logger.log(['CameraService', 'info'], `Starting camera initial configuration`);

        try {
            let result = false;

            const videoSettings = {
                ...this.videoSettings,
                displayOut: 1
            };

            this.logger.log(['CameraService', 'info'], `Setting video configuration: ${JSON.stringify(videoSettings)}`);

            result = await this.configureDisplayOut(videoSettings);

            if (result === true) {
                this.logger.log(['CameraService', 'info'], `Retrieving camera settings`);

                const response = JSON.parse(await this.ipcGetRequest('/video'));
                result = response.status;

                if (result === true) {
                    this.videoSettings.resolutionSelectVal = response.resolutionSelectVal;
                    this.resolutions = [...response.resolution];
                    this.videoSettings.encodeModeSelectVal = response.encodeModeSelectVal;
                    this.encoders = [...response.encodeMode];
                    this.videoSettings.bitRateSelectVal = response.bitRateSelectVal;
                    this.bitRates = [...response.bitRate];
                    this.videoSettings.fpsSelectVal = response.fpsSelectVal;
                    this.frameRates = [...response.fps];
                    this.videoSettings.displayOut = response.displayOut;
                }
            }

            if (result === true) {
                this.logger.log(['CameraService', 'info'], `Turning on preview`);

                result = await this.ipcPostRequest('/preview', { switchStatus: true });

                if (result === true) {
                    this.videoPreview = true;
                    this.rtspVideoUrl = this.getRtspVideoUrl();
                }
            }

            if (result === true) {
                const ensureResult = await this.fileHandler.ensureModelFilesExist(this.fileHandler.currentModelFolderPath);
                if (ensureResult.dlcExists) {
                    this.modelFiles = ensureResult.modelFiles;

                    this.logger.log(['CameraService', 'info'], `Turning on VAM`);

                    result = await this.ipcPostRequest('/vam', { switchStatus: true, vamconfig: 'MD' });

                    if (result === true) {
                        this.vamProcessing = true;

                        this.logger.log(['CameraService', 'info'], `Retrieving RTSP VAM url`);

                        result = await this.getRtspVamUrl();
                    }

                    if (result === true) {
                        this.logger.log(['CameraService', 'info'], `Configuring inference overlay`);

                        result = await this.configureOverlay('inference');
                    }

                    if (result === true) {
                        this.logger.log(['CameraService', 'info'], `Turning on inference overlay`);

                        result = await this.ipcPostRequest('/overlay', { switchStatus: true });
                    }

                    if (result === true) {
                        const activeDeviceSettings = {
                            [DeviceProperty.IpAddress]: this.ipAddresses.cameraIpAddress,
                            [DeviceProperty.RtspVideoUrl]: this.sessionToken ? this.rtspVideoUrl : '',
                            [DeviceProperty.RtspDataUrl]: this.sessionToken ? this.rtspVamUrl : '',
                            [DeviceProperty.Resolution]: this.sessionToken ? this.resolutions[this.videoSettings.resolutionSelectVal] : '',
                            [DeviceProperty.Encoder]: this.sessionToken ? this.encoders[this.videoSettings.encodeModeSelectVal] : '',
                            [DeviceProperty.Bitrate]: this.sessionToken ? this.bitRates[this.videoSettings.bitRateSelectVal] : '',
                            [DeviceProperty.Fps]: this.sessionToken ? this.frameRates[this.videoSettings.fpsSelectVal] : '',
                            [DeviceSetting.HdmiOutput]: this.videoPreview ? 1 : 0,
                            [DeviceState.InferenceProcessor]: this.vamProcessing ? 'On' : 'Off',
                            [DeviceState.Session]: this.sessionToken ? 'Active' : 'Inactive'
                        };

                        forget(this.iotCentral.sendMeasurement, MeasurementType.Event, activeDeviceSettings);

                        this.logger.log(['CameraService', 'info'], `Starting inference processing service`);

                        result = await this.inferenceProcessor.startInferenceProcessor(this.rtspVamUrl, this.rtspVideoUrl);
                    }
                }
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed during initSession: ${ex.message}`);

            return false;
        }
    }

    private async configureInferenceOverlay(): Promise<boolean> {
        const payload = {
            ov_type_SelectVal: 5,
            ov_position_SelectVal: 0,
            ov_color: '869007615',
            ov_usertext: 'Text',
            ov_start_x: 0,
            ov_start_y: 0,
            ov_width: 0,
            ov_height: 0
        };

        try {
            return this.ipcPostRequest('/overlayconfig', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async configureTextOverlay(text: string): Promise<boolean> {
        const payload = {
            ov_type_SelectVal: 0,
            ov_position_SelectVal: 0,
            ov_color: '869007615',
            ov_usertext: text,
            ov_start_x: 0,
            ov_start_y: 0,
            ov_width: 0,
            ov_height: 0
        };

        try {
            return this.ipcPostRequest('overlayconfig', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async getRtspVamUrl(): Promise<boolean> {
        try {
            const response = await this.ipcGetRequest('/vam');
            const result = JSON.parse(response);

            this.rtspVamUrl = result.url || '';

            return result.status;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private getRtspVideoUrl(): string {
        return `rtsp://${this.ipAddresses.cameraIpAddress}:${this.rtspVideoPort}/live`;
    }

    private async ipcLogin(): Promise<boolean> {
        try {
            const options = {
                method: 'POST',
                url: `http://${this.ipAddresses.cameraIpAddress}:${this.ipcPort}/login`,
                json: true,
                body: {
                    username: this.cameraUserName,
                    userpwd: this.cameraPassword
                }
            };

            this.logger.log(['ipcProvider', 'info'], `LOGIN API: ${options.url}`);

            let result = {
                body: {
                    status: false
                }
            };

            for (let iLoginAttempts = 0; !_get(result, 'body.status') && iLoginAttempts < this.maxLoginAttempts; ++iLoginAttempts) {
                try {
                    if (iLoginAttempts > 0) {
                        this.logger.log(['ipcProvider', 'warn'], `LOGIN ATTEMPT ${iLoginAttempts + 1} of ${this.maxLoginAttempts}: ${options.url}`);
                    }

                    result = await this.makeRequest(options);
                }
                catch (ex) {
                    if (ex.code !== 'ETIMEDOUT') {
                        throw new Error(ex);
                    }
                }
            }

            const status = _get(result, 'body.status');
            this.logger.log(['ipcProvider', 'info'], `RESPONSE BODY: ${status}`);

            if (status === true) {
                this.logger.log(['ipcProvider', 'info'], `RESPONSE COOKIE: ${_get(result, 'response.headers[set-cookie][0]')}`);

                this.sessionToken = _get(result, 'response.headers[set-cookie][0]');
            }
            else {
                this.logger.log(['ipcProvider', 'info'], `Error durring logon`);
            }

            return status;
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async ipcGetRequest(path: string, params?: string): Promise<any> {
        try {
            const result = await this.ipcRequest('GET', path, {}, params);

            return result;
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            return {
                status: false
            };
        }
    }

    private async ipcPostRequest(path: string, payload: any, params?: string): Promise<boolean> {
        try {
            const result = await this.ipcRequest('POST', path, payload, params);

            return result;
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            return false;
        }
    }

    private async ipcRequest(method: string, path: string, payload: any, params?: string): Promise<any> {
        if (!this.sessionToken) {
            throw new Error('No valid login session available');
        }

        try {
            const url = params ? `${path}?${params}` : path;
            const options = {
                method,
                url: `http://${this.ipAddresses.cameraIpAddress}:${this.ipcPort}${url}`,
                headers: {
                    Cookie: this.sessionToken
                }
            };

            if (method === 'POST' && payload) {
                Object.assign(options, {
                    json: true,
                    body: payload
                });
            }

            // this.logger.log(['ipcProvider', 'info'], `${method} API: ${options.url}`);

            const result = await this.makeRequest(options);

            await sleep(250);

            this.logger.log(['ipcProvider', 'info'], `RESPONSE: ${JSON.stringify(_get(result, 'body'))}`);

            const bodyResult = (method === 'POST') ? _get(result, 'body.status') : _get(result, 'body');

            return bodyResult;
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async makeRequest(options): Promise<any> {
        return new Promise((resolve, reject) => {
            request({
                timeout: 10000,
                ...options
            }, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['ipcProvider', 'error'], `makeRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['ipcProvider', 'error'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve({
                    response,
                    body
                });
            });
        });
    }

    private async getWlanIp() {
        let cameraIpAddress = this.config.get('cameraIpAddress');

        if (!cameraIpAddress) {
            // const ifConfigFilter = `ip addr show wlan0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/'`;
            let ifConfigFilter;

            switch (osPlatform()) {
                case 'darwin':
                    ifConfigFilter = `ifconfig | grep "inet " | grep -v 127.0.0.1 | cut -d\  -f2`;
                    break;

                case 'win32':
                    ifConfigFilter = `echo .`;
                    break;

                case 'linux':
                default:
                    ifConfigFilter = `ifconfig wlan0 | grep 'inet ' | cut -d: -f2 | awk '{print $1}'`;
                    break;
            }

            try {
                const { stdout } = await promisify(exec)(ifConfigFilter, { encoding: 'utf8' });

                this.logger.log(['ipcProvider', 'info'], `Determined IP address: ${stdout}`);

                cameraIpAddress = (stdout || '127.0.0.1').trim();
            }
            catch (ex) {
                this.logger.log(['ipcProvider', 'error'], `get ip stderr: ${ex.message}`);
            }
        }

        return {
            cameraIpAddress,
            hostIpAddress: this.config.get('hostIpAddress') || cameraIpAddress
        };
    }
}
