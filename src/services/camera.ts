import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import * as request from 'request';
import { EventEmitter } from 'events';
import * as _get from 'lodash.get';
import { promisify } from 'util';
import { exec } from 'child_process';
import { platform as osPlatform } from 'os';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { StateService } from './state';
import { SubscriptionService } from './subscription';
import { InferenceProcessorService } from '../services/inferenceProcessor';
import { DeviceService } from './device';
import {
    IoTCentralService,
    PeabodySessionState,
    PeabodyInferenceProcessorState,
    PeabodyModuleFieldIds
} from '../services/iotcentral';
import { bind, sleep, forget } from '../utils';
import { HealthState } from './health';

interface ICameraSettings {
    resolutionVal: number;
    encodeModeVal: number;
    bitRateVal: number;
    fpsVal: number;
    vamProcessing: boolean;
}

export interface ICameraResult {
    status: boolean;
    title: string;
    message: string;
    body?: any;
}

const defaultresolutionSelectVal: number = 1;
const defaultencodeModeSelectVal: number = 1;
const defaultbitRateSelectVal: number = 3;
const defaultfpsSelectVal: number = 1;

const defaultCameraUsername: string = 'admin';
const defaultCameraPassword: string = 'admin';
const defaultRtspVideoPort: string = '8900';
const defaultIpcPort: string = '1080';
const resolutions: string[] = [
    '4K',
    '1080P',
    '720P',
    '480P'
];
const encoders: string[] = [
    'HEVC/H.265',
    'AVC/H.264'
];
const bitRates: string[] = [
    '512Kbps',
    '768Kbps',
    '1Mbps',
    '1.5Mbps',
    '2Mbps',
    '3Mbps',
    '4Mbps',
    '6Mbps',
    '8Mbps',
    '10Mbps',
    '20Mbps'
];
const frameRates: string[] = [
    '24',
    '30'
];

@service('camera')
export class CameraService extends EventEmitter {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    @inject('device')
    private device: DeviceService;

    @inject('state')
    private state: StateService;

    @inject('subscription')
    private subscription: SubscriptionService;

    @inject('inferenceProcessor')
    private inferenceProcessor: InferenceProcessorService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private cameraUserName: string = defaultCameraUsername;
    private cameraPassword: string = defaultCameraPassword;
    private rtspVideoPort: string = defaultRtspVideoPort;
    private ipAddresses: any = {
        cameraIpAddress: '127.0.0.1',
        hostIpAddress: '127.0.0.1'
    };
    private sessionToken: string = '';
    private ipcPort: string = defaultIpcPort;
    private rtspVideoUrl: string = '';
    private rtspVamUrl: string = '';
    private modelFile: string = '';
    private currentCameraSettings: ICameraSettings;

    public async init(): Promise<void> {
        this.logger.log(['CameraService', 'info'], 'initialize');

        this.server.method({ name: 'camera.startCamera', method: this.startCamera });
        this.server.method({ name: 'camera.switchVisionAiModel', method: this.handleSwitchVisionAiModel });

        this.cameraUserName = this.config.get('cameraUsername') || defaultCameraUsername;
        this.cameraPassword = this.config.get('cameraPassword') || defaultCameraPassword;
        this.rtspVideoPort = this.config.get('rtspVideoPort') || defaultRtspVideoPort;
        this.ipcPort = this.config.get('ipcPort') || defaultIpcPort;
        this.currentCameraSettings = {
            resolutionVal: Number(this.config.get('cameraResolutionVal')) || defaultresolutionSelectVal,
            encodeModeVal: Number(this.config.get('cameraEncodeModeVal')) || defaultencodeModeSelectVal,
            bitRateVal: Number(this.config.get('cameraBitRateVal')) || defaultbitRateSelectVal,
            fpsVal: Number(this.config.get('cameraFpsVal')) || defaultfpsSelectVal,
            vamProcessing: true
        };
    }

    @bind
    public async startCamera(): Promise<boolean> {
        const result = await this.createCameraSession();

        return result.status;
    }

    public async createCameraSession(): Promise<ICameraResult> {
        let status = false;

        try {
            if (this.sessionToken) {
                this.logger.log(['CameraService', 'info'], `Logging out of existing session (${this.sessionToken})`);

                await this.destroyCameraSession();
            }

            this.ipAddresses = await this.getWlanIp();

            status = await this.ipcLogin();
            if (status === false) {
                // await (this.server.methods.device as any).restartDevice(`ipcCameraInterface:ipcLogin`);
                await (this.server.methods.device as any).restartQmmfServices(`ipcCameraInterface:ipcLogin`);

                status = await this.ipcLogin();
            }

            if (status === true) {
                status = await this.initializeCamera(this.currentCameraSettings);
            }
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);
        }

        if (status === false) {
            this.logger.log(['CameraService', 'error'], `Error during initialization, logging out`);

            const result = await this.destroyCameraSession();

            return {
                ...result,
                status,
                title: 'Login',
                message: `An error occurred while creating a new camera session. Try rebooting the device and login again.`
            };
        }
        else {
            this.subscription.publishCreateSession();

            await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.SessionLogin]: this.sessionToken });

            return {
                ...this.getConfiguration(),
                title: 'Login'
            };
        }
    }

    public async destroyCameraSession(): Promise<ICameraResult> {
        let status = false;

        try {
            this.inferenceProcessor.stopInferenceProcessor();

            if (this.sessionToken) {
                try {
                    status = await this.ipcPostRequest('/logout', {});
                }
                catch (ex) {
                    this.logger.log(['CameraService', 'error'], `logout failed: ${ex.message}`);
                    status = false;
                }

                if (status === false) {
                    this.logger.log(['CameraService', 'warning'], `Restarting Qmmf services`);
                    await (this.server.methods.device as any).restartQmmfServices(`CameraService:destroyCameraSession`);
                }

                await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.SessionLogout]: this.sessionToken });
            }

            status = true;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            status = false;
        }

        this.sessionToken = '';
        this.rtspVideoUrl = '';
        this.rtspVamUrl = '';

        this.subscription.publishDestroySession();

        await this.iotCentral.sendMeasurement({
            [PeabodyModuleFieldIds.Setting.HdmiOutput]: 0,
            [PeabodyModuleFieldIds.State.InferenceProcessor]: PeabodyInferenceProcessorState.Inactive,
            [PeabodyModuleFieldIds.State.Session]: PeabodySessionState.Inactive
        });

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
                    resolution: this.sessionToken ? resolutions[this.currentCameraSettings.resolutionVal] : '',
                    resolutions,
                    encoder: this.sessionToken ? encoders[this.currentCameraSettings.encodeModeVal] : '',
                    encoders,
                    bitRate: this.sessionToken ? bitRates[this.currentCameraSettings.bitRateVal] : '',
                    bitRates,
                    frameRate: this.sessionToken ? frameRates[this.currentCameraSettings.fpsVal] : '',
                    frameRates,
                    modelFile: this.modelFile,
                    hdmiOutput: this.iotCentral.iotcPeabodySettings.hdmiOutput,
                    vamProcessing: this.currentCameraSettings.vamProcessing,
                    wowzaPlayerLicense: this.iotCentral.iotcPeabodySettings.wowzaPlayerLicense || '',
                    wowzaPlayerVideoSourceUrl: this.iotCentral.iotcPeabodySettings.wowzaPlayerVideoSourceUrl || ''
                },
                iotcConfig: {
                    systemName: this.state.system.systemName,
                    systemId: this.state.system.systemId,
                    appUrl: this.state.iotCentral.appUrl,
                    deviceId: this.iotCentral.iotcDeviceId,
                    moduleId: this.iotCentral.iotcModuleId
                }
            }
        };
    }

    public async setCameraSettings(cameraSettings: any): Promise<ICameraResult> {
        let status = false;

        try {
            await this.destroyCameraSession();

            this.currentCameraSettings = {
                ...cameraSettings
            };

            const result = await this.createCameraSession();
            status = result.status;
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
                : 'An error occurred while updating your camera settings'
        };
    }

    public async switchVisionAiModel(fileInfo: any): Promise<ICameraResult> {
        const status = await this.handleSwitchVisionAiModel(fileInfo);

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

    public async resetDevice(resetAction: string): Promise<ICameraResult> {
        const result = await this.destroyCameraSession();

        if (resetAction === 'VAM') {
            forget((this.server.methods.device as any).restartQmmfServices, 'CameraService:resetDevice');
        }
        else if (resetAction === 'DEVICE') {
            forget((this.server.methods.device as any).restartDevice, 'CameraService:resetDevice');
        }

        return result;
    }

    @bind
    public async getHealth(): Promise<number> {
        const inferenceProcessorHealth = await this.inferenceProcessor.getHealth();
        const iotCentralHealth = await this.iotCentral.getHealth();
        const deviceServiceHealth = await this.device.getHealth();

        if (inferenceProcessorHealth[0] < HealthState.Good
            || inferenceProcessorHealth[1] < HealthState.Good
            || iotCentralHealth < HealthState.Good
            || deviceServiceHealth < HealthState.Good) {

            this.logger.log(['CameraService', 'info'], `Health check watch: `
                + `dat:${inferenceProcessorHealth[0]} `
                + `vid:${inferenceProcessorHealth[1]} `
                + `iot:${iotCentralHealth} `
                + `dev:${deviceServiceHealth}`);

            await (this.server.methods.device as any).restartDevice('CameraService:checkHealthState');
            // await (this.server.methods.device as any).restartQmmfServices('CameraService:checkHealthState');

            return HealthState.Critical;
        }

        await this.iotCentral.sendMeasurement({
            [PeabodyModuleFieldIds.Telemetry.CameraSystemHeartbeat]: inferenceProcessorHealth[0] + inferenceProcessorHealth[1] + iotCentralHealth + deviceServiceHealth
        });

        return HealthState.Good;
    }

    @bind
    private async handleSwitchVisionAiModel(fileInfo: any): Promise<boolean> {
        let status = false;

        try {
            await this.destroyCameraSession();

            const fileName = fileInfo.type === 'multipart'
                ? await this.device.saveMultiPartFormModelPackage(fileInfo.file)
                : await this.device.saveUrlModelPackage(fileInfo.fileUrl);

            if (fileName) {
                status = await this.device.extractAndVerifyModelFiles(fileName);

                if (status === true) {
                    status = await this.device.switchVisionAiModelFiles(fileName);

                    const dlcFile = await this.device.ensureModelFilesExist(this.device.currentModelFolderPath);
                    if (dlcFile) {
                        this.modelFile = dlcFile;

                        await this.iotCentral.updateDeviceProperties({ [PeabodyModuleFieldIds.Property.VideoModelName]: this.modelFile });
                    }
                }

                if (status === true) {
                    this.subscription.publishModel(this.modelFile);
                    await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.VideoModelChange]: this.modelFile });
                }
            }

            if (status === true) {
                const result = await this.createCameraSession();
                status = result.status;
            }
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            status = false;
        }

        return status;
    }

    private async initializeCamera(cameraSettings: ICameraSettings): Promise<boolean> {
        this.logger.log(['CameraService', 'info'], `Starting camera initial configuration`);

        try {
            let result = false;

            result = await this.configureVideoPreview(cameraSettings);

            if (result === true && this.iotCentral.iotcPeabodySettings.hdmiOutput === true) {
                result = await this.configureVAMProcessing(cameraSettings);

                if (result === true) {
                    this.logger.log(['CameraService', 'info'], `Starting inference processing service`);

                    result = await this.inferenceProcessor.startInferenceProcessor(this.rtspVamUrl, this.rtspVideoUrl);
                }
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed during initSession: ${ex.message}`);

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

    private getRtspVideoUrl(): boolean {
        this.rtspVideoUrl = `rtsp://${this.ipAddresses.cameraIpAddress}:${this.rtspVideoPort}/live`;

        return true;
    }

    private async configureVideoPreview(cameraSettings: ICameraSettings): Promise<boolean> {
        try {
            this.logger.log(['CameraService', 'info'], `Setting video configuration: ${JSON.stringify(cameraSettings)}`);

            const payload = {
                resolutionSelectVal: (cameraSettings.resolutionVal < resolutions.length) ? cameraSettings.resolutionVal : defaultresolutionSelectVal,
                encodeModeSelectVal: (cameraSettings.encodeModeVal < encoders.length) ? cameraSettings.encodeModeVal : defaultencodeModeSelectVal,
                bitRateSelectVal: (cameraSettings.bitRateVal < bitRates.length) ? cameraSettings.bitRateVal : defaultbitRateSelectVal,
                fpsSelectVal: (cameraSettings.fpsVal < frameRates.length) ? cameraSettings.fpsVal : defaultfpsSelectVal,
                displayOut: this.iotCentral.iotcPeabodySettings.hdmiOutput === true ? 1 : 0
            };

            let result = await this.ipcPostRequest('/video', payload);

            if (result === true) {
                this.logger.log(['CameraService', 'info'], `Setting video preview`);

                result = await this.ipcPostRequest('/preview', { switchStatus: this.iotCentral.iotcPeabodySettings.hdmiOutput });
            }

            if (result === true) {
                result = this.getRtspVideoUrl();
            }

            if (result === true) {
                const activeDeviceProperties = {
                    [PeabodyModuleFieldIds.Property.IpAddress]: this.ipAddresses.cameraIpAddress,
                    [PeabodyModuleFieldIds.Property.RtspVideoUrl]: this.sessionToken ? this.rtspVideoUrl : '',
                    [PeabodyModuleFieldIds.Property.Resolution]: this.sessionToken ? resolutions[this.currentCameraSettings.resolutionVal] : '',
                    [PeabodyModuleFieldIds.Property.Encoder]: this.sessionToken ? encoders[this.currentCameraSettings.encodeModeVal] : '',
                    [PeabodyModuleFieldIds.Property.Bitrate]: this.sessionToken ? bitRates[this.currentCameraSettings.bitRateVal] : '',
                    [PeabodyModuleFieldIds.Property.Fps]: this.sessionToken ? frameRates[this.currentCameraSettings.fpsVal] : ''
                };

                await this.iotCentral.updateDeviceProperties(activeDeviceProperties);

                await this.iotCentral.sendMeasurement({
                    [PeabodyModuleFieldIds.Setting.HdmiOutput]: this.iotCentral.iotcPeabodySettings.hdmiOutput ? 1 : 0
                });
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async configureVAMProcessing(cameraSettings: any): Promise<boolean> {
        try {
            let result = false;

            const dlcFile = await this.device.ensureModelFilesExist(this.device.currentModelFolderPath);
            if (dlcFile) {
                this.modelFile = dlcFile;

                this.logger.log(['CameraService', 'info'], `Turning on VAM`);

                result = await this.ipcPostRequest('/vam', { switchStatus: cameraSettings.vamProcessing, vamconfig: 'MD' });

                if (result === true && cameraSettings.vamProcessing) {
                    this.logger.log(['CameraService', 'info'], `Retrieving RTSP VAM url`);

                    result = await this.getRtspVamUrl();

                    if (result === true) {
                        this.logger.log(['CameraService', 'info'], `Configuring inference overlay`);

                        result = await this.configureOverlay('inference');
                    }

                    if (result === true) {
                        this.logger.log(['CameraService', 'info'], `Turning on inference overlay`);

                        result = await this.ipcPostRequest('/overlay', { switchStatus: true });
                    }
                }

                if (result === true) {
                    await this.iotCentral.updateDeviceProperties({
                        [PeabodyModuleFieldIds.Property.VideoModelName]: this.modelFile
                    });

                    await this.iotCentral.sendMeasurement({
                        [PeabodyModuleFieldIds.State.InferenceProcessor]: this.currentCameraSettings.vamProcessing
                            ? PeabodyInferenceProcessorState.Active
                            : PeabodyInferenceProcessorState.Inactive,
                        [PeabodyModuleFieldIds.State.Session]: this.sessionToken ? PeabodySessionState.Active : PeabodySessionState.Inactive
                    });
                }
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async configureOverlay(type: string, text?: string): Promise<boolean> {
        const payload = {
            ov_type_SelectVal: type === 'inference' ? 5 : 0,
            ov_position_SelectVal: 0,
            ov_color: '869007615',
            ov_usertext: type === 'inference' ? 'Text' : text || '',
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

    private async ipcLogin(): Promise<boolean> {
        let status = false;

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

            this.logger.log(['ipcCameraInterface', 'info'], `LOGIN API: ${options.url}`);

            let result = {
                body: {
                    status: false
                }
            };

            try {
                result = await this.makeRequest(options);

                status = _get(result, 'body.status');
            }
            catch (ex) {
                this.logger.log(['ipcCameraInterface', 'error'], `Login failed with exception: ${ex.message}`);
                status = false;
            }

            this.logger.log(['ipcCameraInterface', 'info'], `RESPONSE BODY: ${status}`);

            if (status === true) {
                this.logger.log(['ipcCameraInterface', 'info'], `RESPONSE COOKIE: ${_get(result, 'response.headers[set-cookie][0]')}`);

                this.sessionToken = _get(result, 'response.headers[set-cookie][0]');
            }
            else {
                this.logger.log(['ipcCameraInterface', 'info'], `Error during logon`);
            }
        }
        catch (ex) {
            this.logger.log(['ipcCameraInterface', 'error'], ex.message);
            status = false;
        }

        return status;
    }

    private async ipcGetRequest(path: string, params?: string): Promise<any> {
        try {
            const result = await this.ipcRequest('GET', path, {}, params);

            return result;
        }
        catch (ex) {
            this.logger.log(['ipcCameraInterface', 'error'], ex.message);

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
            this.logger.log(['ipcCameraInterface', 'error'], ex.message);

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

            // this.logger.log(['ipcCameraInterface', 'info'], `${method} API: ${options.url}`);

            const result = await this.makeRequest(options);

            await sleep(250);

            this.logger.log(['ipcCameraInterface', 'info'], `RESPONSE: ${JSON.stringify(_get(result, 'body'))}`);

            const bodyResult = (method === 'POST') ? _get(result, 'body.status') : _get(result, 'body');

            return bodyResult;
        }
        catch (ex) {
            this.logger.log(['ipcCameraInterface', 'error'], ex.message);

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
                    this.logger.log(['ipcCameraInterface', 'error'], `makeRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['ipcCameraInterface', 'error'], `Response status code = ${response.statusCode}`);

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
            cameraIpAddress = '127.0.0.1';

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
                    // Docker base image opencvnode-base-arm32v7
                    // ifConfigFilter = `ifconfig wlan0 | grep 'inet ' | cut -d: -f2 | awk '{print $1}'`;

                    // Docker base image opencvnode-base-arm32v7 - get Docker internal bridge gateway address
                    // ifConfigFilter = `printf "%d.%d.%d.%d" $(awk '$2 == 00000000 && $7 == 00000000 { for (i = 8; i >= 2; i=i-2) { print "0x" substr($3, i-1, 2) } }' /proc/net/route)`;

                    // Docker base image arm32v7/node:10-slim
                    ifConfigFilter = `ifconfig wlan0 | grep 'inet ' | awk '{print $2}'`;
                    break;
            }

            try {
                const { stdout } = await promisify(exec)(ifConfigFilter, { encoding: 'utf8' });

                this.logger.log(['ipcCameraInterface', 'info'], `Determined IP address: ${stdout}`);

                cameraIpAddress = (stdout || '127.0.0.1').trim();
            }
            catch (ex) {
                this.logger.log(['ipcCameraInterface', 'error'], `get ip stderr: ${ex.message}`);
            }
        }

        return {
            cameraIpAddress,
            hostIpAddress: this.config.get('hostIpAddress') || cameraIpAddress
        };
    }
}
