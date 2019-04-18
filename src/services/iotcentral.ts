import { service, inject } from 'spryly';
import { Server } from 'hapi';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as crypto from 'crypto';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { sleep, bind, forget } from '../utils';
import { HealthStates } from './serverTypes';
import * as AzureIotDeviceMqtt from 'azure-iot-device-mqtt';
import * as AzureIotDevice from 'azure-iot-device';

export const MessageType = {
    Telemetry: 'telemetry',
    State: 'state',
    Event: 'event',
    Setting: 'setting'
};

export const DeviceTelemetry = {
    Inference: 'telemetry_inference',
    Heartbeat: 'telemetry_hearbeat'
};

export const DeviceState = {
    InferenceProcessor: 'state_inference_processor',
    Session: 'state_session'
};

export const DeviceEvent = {
    SessionLogin: 'event_session_login',
    SessionLogout: 'event_session_logout',
    DataStreamProcessingStarted: 'event_datastream_processing_started',
    DataStreamProcessingStopped: 'event_datastream_processing_stopped',
    DataStreamProcessingError: 'event_datastream_processing_error',
    VideoStreamProcessingStarted: 'event_videostream_processing_started',
    VideoStreamProcessingStopped: 'event_videostream_processing_stopped',
    VideoStreamProcessingError: 'event_videostream_processing_error',
    VideoModelChange: 'event_video_model_change',
    DeviceRestart: 'event_device_restart',
    ImageProvisionComplete: 'event_image_provision_complete'
};

export const DeviceSetting = {
    HdmiOutput: 'setting_hdmi_output',
    InferenceThreshold: 'setting_inference_threshold',
    VideoModelUrl: 'setting_video_model_url'
};

export const DeviceProperty = {
    IpAddress: 'prop_ip_address',
    RtspVideoUrl: 'prop_rtsp_video_url',
    RtspDataUrl: 'prop_rtsp_data_url',
    Bitrate: 'prop_bitrate',
    Encoder: 'prop_encoder',
    Fps: 'prop_fps',
    Resolution: 'prop_resolution',
    ImageVersion: 'prop_image_version',
    VideoModelName: 'prop_video_model_name'
};

export const DeviceCommand = {
    SwitchVisionAiModel: 'command_switch_vision_ai_model',
    StartTrainingMode: 'command_start_training_mode',
    RestartDevice: 'command_restart_device'
};

export const DeviceCommandParams = {
    VisionModeluri: 'command_param_vision_model_uri'
};

const SECONDS_PER_MINUTE: number = (60);
const SECONDS_PER_HOUR: number = (60 * 60);

const defaultIotCentralDpsProvisionApiVersion: string = '2019-01-15';
const defaultIotCentralDpsAssigningApiVersion: string = '2018-11-01';
const defaultIotCentralDpsEndpoint: string = 'https://global.azure-devices-provisioning.net/###SCOPEID/registrations/###DEVICEID';
const defaultIotCentralDpsRegistrationSuffix: string = '/register?api-version=###API_VERSION';
const defaultIotCentralDpsOperationsSuffix: string = '/operations/###OPERATION_ID?api-version=###API_VERSION';
const defaultIotCentralExpiryHours: string = '2';
const hearbeatStatusClientConnected: number = 1;
const hearbeatStatusReceivedDeviceTwin: number = 2;
const hearbeatStatusReportedDeviceProperties: number = 3;

@service('iotCentral')
export class IoTCentralService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('state')
    private state: StateService;

    private iotCentralScopeIdInternal: string = '';
    private iotCentralTemplateIdInternal: string = '';
    private iotCentralTemplateVersionInternal: string = '';
    private iotCentralDpsProvisionApiVersion: string = defaultIotCentralDpsProvisionApiVersion;
    private iotCentralDpsAssigningApiVersion: string = defaultIotCentralDpsAssigningApiVersion;
    private iotCentralDpsEndpoint: string = defaultIotCentralDpsEndpoint;
    private iotCentralDpsRegistrationSuffix: string = defaultIotCentralDpsRegistrationSuffix;
    private iotCentralDpsOperationsSuffix: string = defaultIotCentralDpsOperationsSuffix;
    private iotCentralExpiryHours: string = defaultIotCentralExpiryHours;

    private iotCentralHubConnectionStringInternal: string = '';
    private iotCentralProvisioningStatusInternal: string = '';
    private iotCentralConnectionStatusInternal: string = '';
    private iotcClient: any = null;
    private iotcDeviceTwin: any = null;
    private iotcClientConnected: boolean = false;
    private iotcTelemetryThrottleTimer: number = Date.now();
    private handleHdmiOutputSettingChangeCallback: any = null;
    private handleInferenceThresholdSettingChangeCallback: any = null;
    private heartbeatTimer: NodeJS.Timer = null;
    private heartbeatStatus: number = 0;

    public get iotCentralScopeId() {
        return this.iotCentralScopeIdInternal;
    }

    public get iotCentralTemplateId() {
        return this.iotCentralTemplateIdInternal;
    }

    public get iotCentralTemplateVersion() {
        return this.iotCentralTemplateVersionInternal;
    }

    public get iotCentralHubConnectionString() {
        return this.iotCentralHubConnectionStringInternal;
    }

    public get iotCentralProvisioningStatus() {
        return this.iotCentralProvisioningStatusInternal;
    }

    public get iotCentralConnectionStatus() {
        return this.iotCentralConnectionStatusInternal;
    }

    public async init(): Promise<void> {
        this.iotCentralScopeIdInternal = this.config.get('iotCentralScopeId') || '';
        this.iotCentralTemplateIdInternal = this.config.get('iotCentralTemplateId') || '';
        this.iotCentralTemplateVersionInternal = this.config.get('iotCentralTemplateVersion') || '';
        this.iotCentralDpsProvisionApiVersion = this.config.get('iotCentralDpsProvisionApiVersion') || defaultIotCentralDpsProvisionApiVersion;
        this.iotCentralDpsAssigningApiVersion = this.config.get('iotCentralDpsAssigningApiVersion') || defaultIotCentralDpsAssigningApiVersion;
        this.iotCentralDpsEndpoint = this.config.get('iotCentralDpsEndpoint') || defaultIotCentralDpsEndpoint;
        this.iotCentralDpsRegistrationSuffix = this.config.get('iotCentralDpsRegistrationSuffix') || defaultIotCentralDpsRegistrationSuffix;
        this.iotCentralDpsOperationsSuffix = this.config.get('iotCentralDpsOperationsSuffix') || defaultIotCentralDpsOperationsSuffix;
        this.iotCentralExpiryHours = this.config.get('iotCentralExpiryHours') || defaultIotCentralExpiryHours;

        this.server.method({
            name: 'iotCentral.connectToIoTCentral',
            method: this.connectToIoTCentral
        });
    }

    @bind
    public async connectToIoTCentral(): Promise<void> {
        const iotcResult = await this.iotCentralDpsProvisionDevice();

        if (iotcResult === true) {
            await this.connectIotcClient();
        }
    }

    public async iotCentralDpsProvisionDevice(): Promise<boolean> {
        if (!this.config.get('enableIoTCentralProvisioning')) {
            return false;
        }

        if (!_get(this.state, 'iotCentral.deviceId')) {
            this.logger.log(['IoTCentralService', 'warning'], `Missing device state configuration - skipping IoT Central DPS provisioning`);
            return false;
        }

        this.logger.log(['IoTCentralService', 'info'], `Enabling DPS provisioning through IoT Central: "enableIoTCentralProvisioning=1"`);

        const iotCentralState = this.state.iotCentral;
        let result = true;
        let provisioningStatus = `IoT Central successfully provisioned device: ${iotCentralState.deviceId}`;

        try {
            this.logger.log(['IoTCentralService', 'info'], `Starting IoT Central provisioning for device: ${iotCentralState.deviceId}`);

            const expiry = (Date.now() - (SECONDS_PER_MINUTE * 5) + (SECONDS_PER_HOUR * Number(this.iotCentralExpiryHours)));
            const sr = `${this.iotCentralScopeId}%2fregistrations%2f${iotCentralState.deviceId}`;
            const sig = this.computDerivedSymmetricKey(iotCentralState.deviceKey, `${sr}\n${expiry}`);

            const options = {
                method: 'PUT',
                url: this.iotCentralDpsEndpoint.replace('###SCOPEID', this.iotCentralScopeId).replace('###DEVICEID', iotCentralState.deviceId)
                    + this.iotCentralDpsRegistrationSuffix.replace('###API_VERSION', this.iotCentralDpsProvisionApiVersion),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json; charset=utf-8',
                    'Connection': 'keep-alive',
                    'UserAgent': 'prov_device_client/1.0',
                    'Authorization': `SharedAccessSignature sr=${sr}&sig=${encodeURIComponent(sig)}&se=${expiry}&skn=registration`
                },
                body: {
                    registrationId: iotCentralState.deviceId,
                    data: {
                        iotcModelId: `${this.iotCentralTemplateId}/${this.iotCentralTemplateVersion}`
                    }
                },
                json: true
            };

            let response = await this.iotcRequest(options);

            const operationId = _get(response, 'operationId');

            this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

            delete options.body;
            options.method = 'GET';
            options.url = this.iotCentralDpsEndpoint.replace('###SCOPEID', this.iotCentralScopeId).replace('###DEVICEID', iotCentralState.deviceId)
                + this.iotCentralDpsOperationsSuffix.replace('###OPERATION_ID', operationId).replace('###API_VERSION', this.iotCentralDpsAssigningApiVersion);

            const errorCode = _get(response, 'errorCode');
            if (errorCode) {
                this.logger.log(['IoTCentralService', 'error'], `IoT Central dps provisioning error code: ${errorCode}`);

                result = false;
            }

            if (result === true) {
                while (_get(response, 'status') === 'assigning') {
                    await sleep(2500);
                    this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

                    response = await this.iotcRequest(options);
                }

                if (_get(response, 'status') === 'assigned') {
                    const iotcHub = _get(response, 'registrationState.assignedHub');

                    this.logger.log(['IoTCentralService', 'info'], `IoT Central dps hub assignment: ${iotcHub}`);

                    this.iotCentralHubConnectionStringInternal = `HostName=${iotcHub};DeviceId=${iotCentralState.deviceId};SharedAccessKey=${iotCentralState.deviceKey}`;

                    result = true;
                }
            }

            if (result === false) {
                provisioningStatus = `IoT Central dps provisioning error code: ${errorCode}`;
                this.logger.log(['IoTCentralService', 'error'], provisioningStatus);
            }
        }
        catch (ex) {
            provisioningStatus = `IoT Central dps provisioning error: ${ex.message}`;
            this.logger.log(['IoTCentralService', 'error'], provisioningStatus);

            result = false;
        }

        this.iotCentralConnectionStatusInternal = provisioningStatus;

        return result;
    }

    public async connectIotcClient(): Promise<boolean> {
        let result = true;
        let connectionStatus = `IoT Central successfully connected device: ${this.state.iotCentral.deviceId}`;

        if (this.iotcClient) {
            await this.iotcClient.close();
            this.iotcClient = null;
        }

        this.iotcClient = AzureIotDeviceMqtt.clientFromConnectionString(this.iotCentralHubConnectionString);
        if (!this.iotcClient) {
            result = false;
        }

        if (result === true) {
            try {
                await this.iotcClient.open();

                this.heartbeatStatus = hearbeatStatusClientConnected;

                this.iotcClient.on('error', this.onIotcClientError);

                this.iotcClient.onDeviceMethod(DeviceCommand.StartTrainingMode, this.iotcClientStartTraining);

                this.iotcDeviceTwin = await this.iotcClient.getTwin();

                this.heartbeatStatus = hearbeatStatusReceivedDeviceTwin;

                this.iotcDeviceTwin.on('properties.desired', this.onNewDeviceProperties);

                this.iotcClientConnected = true;

                await this.updateDeviceProperties(this.state.iotCentral.properties);

                this.heartbeatStatus = hearbeatStatusReportedDeviceProperties;

                this.heartbeatTimer = setInterval(this.sendHeartbeatStatus, (1000 * 15));
            }
            catch (ex) {
                connectionStatus = `IoT Central connection error: ${ex.message}`;
                this.logger.log(['IoTCentralService', 'error'], connectionStatus);

                result = false;
            }
        }

        this.iotCentralProvisioningStatusInternal = connectionStatus;

        return result;
    }

    @bind
    public async sendMeasurement(messageType: string, data: any) {
        if (!data || !this.iotcClientConnected) {
            return;
        }

        if (messageType === MessageType.Telemetry && ((Date.now() - this.iotcTelemetryThrottleTimer) < 1000 || !data || !this.iotcClientConnected)) {
            return;
        }

        this.iotcTelemetryThrottleTimer = Date.now();

        const iotcMessage = new AzureIotDevice.Message(JSON.stringify(data));

        try {
            // await this.iotcClientSendMeasurement(iotcMessage);
            await this.iotcClient.sendEvent(iotcMessage);

            this.logger.log(['IoTCentralService', 'info'], `Device ${messageType} message sent`);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `sendMeasurement: ${ex.message}`);
        }
    }

    @bind
    public async updateDeviceProperties(properties: any): Promise<void> {
        if (!properties || !this.iotcClientConnected) {
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                this.iotcDeviceTwin.properties.reported.update(properties, (error) => {
                    if (error) {
                        return reject(error);
                    }

                    return resolve();
                });
            });

            this.logger.log(['IoTCentralService', 'info'], `Device live properties updated`);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Error while updating client properties: ${ex.message}`);
        }
    }

    public setHdmiOutputSettingChangeCallback(handleHdmiOutputSettingChangeCallback: any) {
        this.handleHdmiOutputSettingChangeCallback = handleHdmiOutputSettingChangeCallback;
    }

    public setInferenceThresholdSettingChangeCallback(handleInferenceThresholdSettingChange: any) {
        this.handleInferenceThresholdSettingChangeCallback = handleInferenceThresholdSettingChange;
    }

    public getHealth(): any {
        return HealthStates.Good;
    }

    private async handleVideoModelUrlSettingChange(newValue): Promise<any> {
        this.logger.log(['IoTCentralService', 'info'], `Handle property change for VideoModelUrl setting`);

        return {
            value: newValue,
            status: 'completed'
        };
    }

    @bind
    private async onNewDeviceProperties(desiredChangedSettings: any) {
        for (const setting in desiredChangedSettings) {
            if (!desiredChangedSettings.hasOwnProperty(setting)) {
                continue;
            }

            if (setting === '$version') {
                continue;
            }

            const prop = desiredChangedSettings[setting];
            if (!prop.hasOwnProperty('value')) {
                continue;
            }

            const value = prop.value;
            let changedSettingResult;

            switch (setting) {
                case DeviceSetting.HdmiOutput:
                    changedSettingResult = await this.handleHdmiOutputSettingChangeCallback(value);
                    break;

                case DeviceSetting.InferenceThreshold:
                    changedSettingResult = await this.handleInferenceThresholdSettingChangeCallback(value);
                    break;

                case DeviceSetting.VideoModelUrl:
                    changedSettingResult = await this.handleVideoModelUrlSettingChange(value);
                    break;

                default:
                    this.logger.log(['IoTCentralService', 'error'], `Recieved desired property change for unknown setting ${setting}`);
                    break;
            }

            if (changedSettingResult) {
                const patchedProperty = {
                    [setting]: {
                        ...changedSettingResult,
                        statusCode: 200,
                        desiredVersion: desiredChangedSettings.$version,
                        message: 'Succeeded'
                    }
                };

                await this.updateDeviceProperties(patchedProperty);
            }
        }
    }

    @bind
    private sendHeartbeatStatus() {
        this.logger.log(['IoTCentralService', 'info'], `Heartbeat status: ${this.heartbeatStatus}`);

        forget(this.sendMeasurement, MessageType.Telemetry, { [DeviceTelemetry.Heartbeat]: this.heartbeatStatus });
    }

    private computDerivedSymmetricKey(secret: string, id: string): string {
        const secretBuffer = Buffer.from(secret, 'base64');
        const derivedSymmetricKey = crypto.createHmac('SHA256', secretBuffer).update(id, 'utf8').digest('base64');

        return derivedSymmetricKey;
    }

    @bind
    private onIotcClientError(error: Error) {
        this.logger.log(['IoTCentralService', 'error'], `Client connection error: ${error.message}`);

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientStartTraining(commandRequest: any, commandResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.StartTrainingMode} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'warning'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientSwitchVideoModel(commandRequest: any, commandResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.SwitchVisionAiModel} command received`);

        const url = 'foo';
        forget((this.server.methods.camera as any).changeVideoModel, { type: 'url', fielUrl: url });

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'warning'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientRestartDevice(commandRequest: any, commandResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.RestartDevice} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'warning'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });

        forget((this.server.methods.fileHandler as any).signalRestart);
    }

    private async iotcRequest(options: any): Promise<any> {
        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['IoTCentralService', 'error'], `iotcRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['IoTCentralService', 'error'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve(body);
            });
        });
    }
}
