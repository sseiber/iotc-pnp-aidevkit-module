import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as crypto from 'crypto';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { sleep, bind } from '../utils';
import { HealthState } from './serverTypes';
import * as AzureIotDeviceMqtt from 'azure-iot-device-mqtt';
import * as AzureIotDevice from 'azure-iot-device';

export const MessageType = {
    Telemetry: 'telemetry',
    State: 'state',
    Event: 'event',
    Setting: 'setting'
};

export const DeviceTelemetry = {
    CameraSystemHeartbeat: 'telemetry_camera_system_heartbeat',
    Detections: 'telemetry_detection_count',
    AllDetections: 'telemetry_all_detections_count',
    BatteryLevel: 'telemetry_battery_level'
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
    QmmfRestart: 'event_qmmf_restart',
    ImageProvisionComplete: 'event_image_provision_complete',
    Inference: 'event_inference'
};

export const DeviceSetting = {
    HdmiOutput: 'setting_hdmi_output',
    InferenceThreshold: 'setting_inference_threshold',
    DetectClass: 'setting_detect_class'
};

export const DeviceProperty = {
    IpAddress: 'prop_ip_address',
    RtspVideoUrl: 'prop_rtsp_video_url',
    IoTCentralConnectionStatus: 'prop_iotc_connection_status',
    Bitrate: 'prop_bitrate',
    Encoder: 'prop_encoder',
    Fps: 'prop_fps',
    Resolution: 'prop_resolution',
    ImageVersion: 'prop_image_version',
    ImageStatus: 'prop_image_provision_status',
    VideoModelName: 'prop_video_model_name',
    FirmwareVersion: 'prop_firmware_version',
    BatteryLevel: 'prop_battery_level'
};

export const ProvisionStatus = {
    Installing: 'Installing',
    Pending: 'Pending',
    Completed: 'Completed',
    Restarting: 'Restarting'
};

export const DeviceCommand = {
    SwitchVisionAiModel: 'command_switch_vision_ai_model',
    StartTrainingMode: 'command_start_training_mode',
    RestartDevice: 'command_restart_device'
};

export const DeviceCommandParams = {
    VisionModelUrl: 'command_param_vision_model_url'
};

const SECONDS_PER_MINUTE: number = (60);
const SECONDS_PER_HOUR: number = (60 * 60);

const defaultIotCentralDpsProvisionApiVersion: string = '2019-01-15';
const defaultIotCentralDpsAssigningApiVersion: string = '2019-01-15';
const defaultIotCentralDpsEndpoint: string = 'https://global.azure-devices-provisioning.net/###SCOPEID/registrations/###DEVICEID';
const defaultIotCentralDpsRegistrationSuffix: string = '/register?api-version=###API_VERSION';
const defaultIotCentralDpsOperationsSuffix: string = '/operations/###OPERATION_ID?api-version=###API_VERSION';
const defaultIotCentralExpiryHours: string = '2';

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
    private iotCentralDcmidInternal: string = '';
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

    public get iotCentralScopeId() {
        return this.iotCentralScopeIdInternal;
    }

    public get iotCentralDcmid() {
        return this.iotCentralDcmidInternal;
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
        this.logger.log(['IoTCentral', 'info'], 'initialize');

        this.server.method({ name: 'iotCentral.connectToIoTCentral', method: this.connectToIoTCentral });

        this.iotCentralScopeIdInternal = this.config.get('iotCentralScopeId') || '';
        this.iotCentralDcmidInternal = this.config.get('iotCentralDcmid') || '';
        this.iotCentralDpsProvisionApiVersion = this.config.get('iotCentralDpsProvisionApiVersion') || defaultIotCentralDpsProvisionApiVersion;
        this.iotCentralDpsAssigningApiVersion = this.config.get('iotCentralDpsAssigningApiVersion') || defaultIotCentralDpsAssigningApiVersion;
        this.iotCentralDpsEndpoint = this.config.get('iotCentralDpsEndpoint') || defaultIotCentralDpsEndpoint;
        this.iotCentralDpsRegistrationSuffix = this.config.get('iotCentralDpsRegistrationSuffix') || defaultIotCentralDpsRegistrationSuffix;
        this.iotCentralDpsOperationsSuffix = this.config.get('iotCentralDpsOperationsSuffix') || defaultIotCentralDpsOperationsSuffix;
        this.iotCentralExpiryHours = this.config.get('iotCentralExpiryHours') || defaultIotCentralExpiryHours;
    }

    @bind
    public async connectToIoTCentral(): Promise<void> {
        const iotcResult = await this.iotCentralDpsProvisionDevice();

        if (iotcResult === true) {
            await this.connectIotcClient();
        }
    }

    public async iotCentralDpsProvisionDevice(): Promise<boolean> {
        if (this.config.get('enableIoTCentralProvisioning') !== '1') {
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
                        '__iot:interfaces': {
                            ModelRepositoryUri: this.iotCentralDcmid,
                            CapabilityModelUri: this.iotCentralDcmid
                        }
                    }
                },
                json: true
            };

            // check with paolo
            let response = await this.iotcRequest(options);

            const errorCode = _get(response, 'errorCode');
            if (errorCode) {
                this.logger.log(['IoTCentralService', 'error'], `IoT Central dps provisioning error code: ${errorCode}`);

                result = false;
            }

            if (result === true) {
                const operationId = _get(response, 'operationId');

                this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

                delete options.body;
                options.method = 'GET';
                options.url = this.iotCentralDpsEndpoint.replace('###SCOPEID', this.iotCentralScopeId).replace('###DEVICEID', iotCentralState.deviceId)
                    + this.iotCentralDpsOperationsSuffix.replace('###OPERATION_ID', operationId).replace('###API_VERSION', this.iotCentralDpsAssigningApiVersion);

                while (_get(response, 'status') === 'assigning') {
                    await sleep(2500);
                    this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

                    response = await this.iotcRequest(options);
                }

                const status = _get(response, 'status') || 'unknown';
                if (status === 'assigned') {
                    const iotcHub = _get(response, 'registrationState.assignedHub');

                    this.logger.log(['IoTCentralService', 'info'], `IoT Central dps hub assignment: ${iotcHub}`);

                    this.iotCentralHubConnectionStringInternal = `HostName=${iotcHub};DeviceId=${iotCentralState.deviceId};SharedAccessKey=${iotCentralState.deviceKey}`;

                    result = true;
                }
                else {
                    const errorMessage = _get(response, 'registrationState.errorMessage') || '';
                    this.logger.log(['IoTCentralService', 'info'], `IoT Central dps unexpected status: ${status}: ${errorMessage}`);

                    result = false;
                }
            }

            if (result === false) {
                provisioningStatus = `IoT Central dps provisioning failed`;
                this.logger.log(['IoTCentralService', 'error'], provisioningStatus);
            }
        }
        catch (ex) {
            provisioningStatus = `IoT Central dps provisioning error: ${ex.message}`;
            this.logger.log(['IoTCentralService', 'error'], provisioningStatus);

            result = false;
        }

        this.iotCentralProvisioningStatusInternal = provisioningStatus;

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

                this.iotcClient.on('error', this.onIotcClientError);

                this.iotcClient.onDeviceMethod(DeviceCommand.StartTrainingMode, this.iotcClientStartTraining);
                this.iotcClient.onDeviceMethod(DeviceCommand.SwitchVisionAiModel, this.iotcClientSwitchVisionAiModel);
                this.iotcClient.onDeviceMethod(DeviceCommand.RestartDevice, this.iotcClientRestartDevice);

                this.iotcDeviceTwin = await this.iotcClient.getTwin();

                this.iotcDeviceTwin.on('properties.desired', this.onHandleDeviceProperties);

                this.iotcClientConnected = true;

                await this.updateDeviceProperties({
                    ...this.state.iotCentral.properties,
                    [DeviceProperty.IoTCentralConnectionStatus]: connectionStatus
                });
            }
            catch (ex) {
                connectionStatus = `IoT Central connection error: ${ex.message}`;
                this.logger.log(['IoTCentralService', 'error'], connectionStatus);

                result = false;
            }
        }

        this.iotCentralConnectionStatusInternal = connectionStatus;

        return result;
    }

    public async sendInferenceData(inferenceTelemetryData: any, inferenceEventData: any) {
        if (!inferenceTelemetryData || !this.iotcClientConnected) {
            return;
        }

        if (((Date.now() - this.iotcTelemetryThrottleTimer) < 1000)) {
            return;
        }

        try {
            this.iotcTelemetryThrottleTimer = Date.now();

            await this.sendMeasurement(MessageType.Telemetry, inferenceTelemetryData);

            await this.sendMeasurement(MessageType.Event, inferenceEventData);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `sendInferenceData: ${ex.message}`);
        }
    }

    @bind
    public async sendMeasurement(messageType: string, data: any): Promise<void> {
        if (!data || !this.iotcClientConnected) {
            return;
        }

        try {
            const iotcMessage = new AzureIotDevice.Message(JSON.stringify(data));

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

    public async getHealth(): Promise<number> {
        return HealthState.Good;
    }

    @bind
    private async onHandleDeviceProperties(desiredChangedSettings: any) {
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
                    changedSettingResult = await (this.server.methods.camera as any).cameraSettingChange(setting, value);
                    break;

                case DeviceSetting.InferenceThreshold:
                case DeviceSetting.DetectClass:
                    changedSettingResult = await (this.server.methods.inferenceProcessor as any).inferenceSettingChange(setting, value);
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

    private computDerivedSymmetricKey(secret: string, id: string): string {
        const secretBuffer = Buffer.from(secret, 'base64');
        const derivedSymmetricKey = crypto.createHmac('SHA256', secretBuffer).update(id, 'utf8').digest('base64');

        return derivedSymmetricKey;
    }

    @bind
    private onIotcClientError(error: Error) {
        this.logger.log(['IoTCentralService', 'error'], `Client connection error: ${error.message}`);

        // forget(this.updateDeviceProperties, { [DeviceProperty.IoTCentralConnectionStatus]: error.message });
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientStartTraining(commandRequest: any, commandResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.StartTrainingMode} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });
    }

    @bind
    private async iotcClientSwitchVisionAiModel(iotcRequest: any, iotcResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.SwitchVisionAiModel} command received`);

        const fileUrl = _get(iotcRequest, `payload.${DeviceCommandParams.VisionModelUrl}`);

        iotcResponse.send(fileUrl ? 200 : 400, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });

        if (fileUrl) {
            try {
                await (this.server.methods.camera as any).switchVisionAiModel({ type: 'url', fileUrl });
            }
            catch {
                this.logger.log(['IoTCentralService', 'error'], `An exception occurred while trying to switch the vision ai model`);
            }
        }
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientRestartDevice(commandRequest: any, commandResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `${DeviceCommand.RestartDevice} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${DeviceCommand.StartTrainingMode} command: ${error.toString()}`);
            }
        });

        await (this.server.methods.fileHandler as any).restartDevice('IoTCentralService:iotcClientRestartCommand');
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
