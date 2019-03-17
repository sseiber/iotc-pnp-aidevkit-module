import { ConfigService } from '../services/config';
import { LoggingService } from '../services/logging';
import { service, inject } from '@sseiber/sprightly';
import * as request from 'request';
import { EventEmitter } from 'events';
import * as _get from 'lodash.get';
import { promisify } from 'util';
import { exec } from 'child_process';

const defaultResolutionSel: number = 1;
const defaultEncoderSel: number = 1;
const defaultBitRateSel: number = 3;
const defaultFrameRatesSel: number = 1;

const peabodyConfiguration = {
    resolutionSelectVal: 1,
    resolution: [
        '4K',
        '1080P',
        '720P',
        '480P'
    ],
    encodeModeSelectVal: 1,
    encodeMode: [
        'HEVC/H.265',
        'AVC/H.264'
    ],
    bitRateSelectVal: 3,
    bitRate: [
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
    ],
    fpsSelectVal: 1,
    fps: [
        24,
        30
    ],
    displayOut: 1,
    status: true
};

@service('camera')
export class CameraService extends EventEmitter {
    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    private ipAddress: string = '';
    private sessionToken: string = '';
    private port: string = '1080';
    private rtspUrl: string = '';
    private vamUrl: string = '';
    private resolutions: string[] = [];
    private encoders: string[] = [];
    private bitRates: string[] = [];
    private frameRates: number[] = [];

    public get resolutionSelections() {
        return this.resolutions;
    }

    public get encoderSelections() {
        return this.encoders;
    }

    public get bitRateSelections() {
        return this.bitRates;
    }

    public get frameRateSelections() {
        return this.frameRates;
    }

    public async init() {
        this.logger.log(['CameraService', 'info'], 'initialize');

        try {
            this.ipAddress = this.config.get('ipAddress') || await this.getWlanIp();

            let result = await this.login();
            if (result === true) {
                result = await this.getConfiguration();
            }

            if (result === true) {
                result = await this.initializeCamera();
            }
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);
        }
    }

    public async login(): Promise<boolean> {
        if (this.sessionToken) {
            await this.ipcPostRequest('/logout');
        }

        return this.ipcLogin();
    }

    public async logout(): Promise<boolean> {
        try {
            return this.ipcPostRequest('/logout');
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async getConfiguration(): Promise<any> {
        // const response = JSON.parse(await this.ipcGetRequest('/video'));
        const response = peabodyConfiguration;

        // create a synthetic prop for hdmi preview on/off
        // create a synthetic prop for vam engine on/off
        // session id
        // wireless ip
        // rtsp video url
        // rtsp vam url
        // this needs to return the model files
        // perhaps it needs to get the overlay config??

        if (response.status === true) {
            this.resolutions = [...response.resolution];
            this.encoders = [...response.encodeMode];
            this.bitRates = [...response.bitRate];
            this.frameRates = [...response.fps];

            return response;
        }

        return {
            status: response.status
        };
    }

    public async resetCameraServices(): Promise<void> {
        try {
            await promisify(exec)(`pkill /usr/bin/ipc-webserver`);
            await promisify(exec)(`pkill /usr/bin/qmmf-server`);

            await this.sleep(2000);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed to reset system services: ${ex.message}`);
        }
    }

    private async initializeCamera(): Promise<boolean> {
        return true;
        try {
            let result = await this.togglePreview(false);

            if (result === true) {
                result = await this.configurePreview(defaultResolutionSel, defaultEncoderSel, defaultBitRateSel, defaultFrameRatesSel, 0);
            }

            if (result === true) {
                result = await this.togglePreview(true);
            }

            if (result === true) {
                const rtspUrl = await this.getRtspVideoUrl();
                if (rtspUrl === '') {
                    this.logger.log(['CameraService', 'error'], `Expected an rtsp video url but got an empty string`);
                }
            }

            if (result === true) {
                result = await this.togglePreview(false);
            }

            if (result === true) {
                result = await this.configurePreview(defaultResolutionSel, defaultEncoderSel, defaultBitRateSel, defaultFrameRatesSel, 1);
            }

            if (result === true) {
                result = await this.togglePreview(true);
            }

            if (result === true) {
                result = await this.toggleVam(true);
            }

            if (result === true) {
                const vamUrl = await this.getRtspVamUrl();
                if (vamUrl === '') {
                    this.logger.log(['CameraService', 'error'], `Expected a VAM data url but got an empty string`);
                }
            }

            if (result === true) {
                result = await this.configureOverlay('inference');
            }

            if (result === true) {
                result = await this.toggleOverlay(true);
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed during initSession: ${ex.message}`);

            return false;
        }
    }

    private async configurePreview(resolution: number, encoder: number, bitRate: number, frameRate: number, displayOut: number): Promise<boolean> {
        const payload = {
            resolutionSelectVal: (resolution < this.resolutions.length) ? resolution : defaultResolutionSel,
            encodeModeSelectVal: (encoder < this.encoders.length) ? encoder : defaultEncoderSel,
            bitRateSelectVal: (bitRate < this.bitRates.length) ? bitRate : defaultBitRateSel,
            fpsSelectVal: (frameRate < this.frameRates.length) ? frameRate : defaultFrameRatesSel,
            displayOut
        };

        try {
            return this.ipcPostRequest('/video', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async togglePreview(status: boolean): Promise<boolean> {
        const payload = {
            switchStatus: status
        };

        try {
            return this.ipcPostRequest('/preview', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async toggleVam(status): Promise<boolean> {
        const payload = {
            switchStatus: status,
            vamconfig: 'MD'
        };

        try {
            return this.ipcPostRequest('/vam', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private configureOverlay(type: string, text?: string): Promise<boolean> {
        if (type === 'inference') {
            return this.configureInferenceOverlay();
        }
        else if (type === 'text') {
            return this.configureTextOverlay(text);
        }

        this.logger.log(['CameraService', 'error'], 'Invalid overlay type use (inference/text)');
        return Promise.resolve(false);
    }

    private async toggleOverlay(status): Promise<boolean> {
        const payload = {
            switchStatus: status
        };

        try {
            return this.ipcPostRequest('/overlay', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

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

    private async getRtspVamUrl(): Promise<string> {
        try {
            const response = JSON.parse(await this.ipcGetRequest('/vam'));

            this.vamUrl = response.url || '';

            return this.vamUrl;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return '';
        }
    }

    private async getRtspVideoUrl(): Promise<string> {
        try {
            const response = JSON.parse(await this.ipcGetRequest('/preview'));

            this.rtspUrl = response.url || '';

            return this.rtspUrl;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return '';
        }
    }

    private async ipcLogin(): Promise<boolean> {
        try {
            const options = {
                method: 'POST',
                url: `http://${this.ipAddress}:${this.port}/login`,
                json: true,
                body: {
                    username: this.config.get('peabodyUsername'),
                    userpwd: this.config.get('peabodyPassword')
                }
            };

            this.logger.log(['ipcProvider', 'info'], `LOGIN API: ${options.url}`);

            const result = await this.makeRequest(options);

            this.logger.log(['ipcProvider', 'info'], `RESPONSE BODY: ${_get(result, 'body.status')}`);

            if (result.body.status === true) {
                this.logger.log(['ipcProvider', 'info'], `RESPONSE COOKIE: ${_get(result, 'response.headers[set-cookie][0]')}`);

                this.sessionToken = _get(result, 'response.headers[set-cookie][0]');
            }

            return _get(result, 'body.status');
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async ipcGetRequest(path: string, params?: string): Promise<any> {
        return this.ipcRequest('GET', path, params);
    }

    private async ipcPostRequest(path: string, payload?: any, params?: string): Promise<boolean> {
        return this.ipcRequest('POST', path, params, payload);
    }

    private async ipcRequest(method: string, path: string, params: string, payload?: any): Promise<any> {
        if (!this.sessionToken) {
            throw new Error('No valid login session available');
        }

        try {
            const url = params ? `${path}?${params}` : path;
            const options = {
                method,
                url: `http://${this.ipAddress}:${this.port}${url}`,
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

            this.logger.log(['ipcProvider', 'info'], `${method} API: ${options.url}`);

            const result = await this.makeRequest(options);

            await this.sleep(250);

            this.logger.log(['ipcProvider', 'info'], `RESPONSE: ${JSON.stringify(_get(result, 'body'))}`);

            return (method === 'POST') ? _get(result, 'body.status') : _get(result, 'body');
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async makeRequest(options): Promise<any> {
        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
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

    private async sleep(milliseconds: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(() => {
                return resolve();
            }, milliseconds);
        });
    }

    private async getWlanIp() {
        const ifConfigFilter = `ip addr show wlan0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/'`;
        const { stdout } = await promisify(exec)(ifConfigFilter, { encoding: 'utf8' });

        return (stdout || '127.0.0.1').trim();
    }
}
