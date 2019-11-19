import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import * as _get from 'lodash.get';
import {
    arch as osArch,
    platform as osPlatform,
    release as osRelease,
    cpus as osCpus,
    totalmem as osTotalMem,
    freemem as osFreeMem,
    loadavg as osLoadAvg
} from 'os';
import { SubscriptionService } from './subscription';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { bind, defer, emptyObj } from '../utils';
import { HealthState } from './health';
import { ICameraResult } from './camera';
import { Mqtt } from 'azure-iot-device-mqtt';
import {
    ModuleClient,
    Message,
    DeviceMethodRequest,
    DeviceMethodResponse
} from 'azure-iot-device';

export interface ISystemProperties {
    cpuModel: string;
    cpuCores: number;
    cpuUsage: number;
    totalMemory: number;
    freeMemory: number;
}

export interface IPeabodySettings {
    hdmiOutput: boolean;
    inferenceThreshold: number;
    detectClass: string;
    wowzaPlayerLicense: string;
    wowzaPlayerVideoSourceUrl: string;
}

export const IoTCentralDeviceFieldIds = {
    Property: {
        Manufacturer: 'manufacturer',
        Model: 'model',
        SwVersion: 'swVersion',
        OsName: 'osName',
        ProcessorArchitecture: 'processorArchitecture',
        ProcessorManufacturer: 'processorManufacturer',
        TotalStorage: 'totalStorage',
        TotalMemory: 'totalMemory'
    }
};

export enum PeabodyInferenceProcessorState {
    Inactive = 'inactive',
    Active = 'active'
}

export enum PeabodySessionState {
    Inactive = 'inactive',
    Active = 'active'
}

export enum SwapModelCommandParams {
    VisionModelUrl = 'cmParamVisionModelUrl'
}

export const PeabodyModuleFieldIds = {
    Telemetry: {
        CameraSystemHeartbeat: 'tlCameraSystemHeartbeat',
        Detections: 'tlDetectionCount',
        AllDetections: 'tlAllDetectionsCount',
        BatteryLevel: 'tlBatteryLevel',
        FreeMemory: 'rpFreeMemory'
    },
    State: {
        InferenceProcessor: 'stInferenceProcessor',
        Session: 'stSession'
    },
    Event: {
        SessionLogin: 'evSessionLogin',
        SessionLogout: 'evSessionLogout',
        DataStreamProcessingStarted: 'evDataStreamProcessingStarted',
        DataStreamProcessingStopped: 'evDataStreamProcessingStopped',
        DataStreamProcessingError: 'evDataStreamProcessingError',
        VideoStreamProcessingStarted: 'evVideoStreamProcessingStarted',
        VideoStreamProcessingStopped: 'evVideoStreamProcessingStopped',
        VideoStreamProcessingError: 'evVideoStreamProcessingError',
        VideoModelChange: 'evVideoModelChange',
        DeviceRestart: 'evDeviceRestart',
        QmmfRestart: 'evQmmfRestart',
        ImageProvisionComplete: 'evImageProvisionComplete',
        Inference: 'evInference'
    },
    Setting: {
        HdmiOutput: 'wpHdmiOutput',
        InferenceThreshold: 'wpInferenceThreshold',
        DetectClass: 'wpDetectClass',
        WowzaPlayerLicense: 'wpWowzaPlayerLicense',
        WowzaPlayerVideoSourceUrl: 'wpWowzaPlayerVideoSourceUrl'
    },
    Property: {
        IpAddress: 'rpIpAddress',
        RtspVideoUrl: 'rpRtspVideoUrl',
        Bitrate: 'rpBitrate',
        Encoder: 'rpEncoder',
        Fps: 'rpFps',
        Resolution: 'rpResolution',
        ImageVersion: 'rpImageVersion',
        ImageStatus: 'rpImageProvisionStatus',
        VideoModelName: 'rpVideoModelName',
        FirmwareVersion: 'rpFirmwareVersion',
        BatteryLevel: 'rpBatteryLevel'
    },
    Command: {
        SwitchVisionAiModel: 'cmSwitchVisionAiModel',
        StartTrainingMode: 'cmStartTrainingMode',
        RestartDevice: 'cmRestartDevice'
    }
};

export const ProvisionStatus = {
    Installing: 'Installing',
    Pending: 'Pending',
    Completed: 'Completed',
    Restarting: 'Restarting'
};

const defaultConfidenceThreshold: number = 70;
const defaultDetectClass: string = 'PERSON';

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

    @inject('subscription')
    private subscription: SubscriptionService;

    private serviceInitializing: boolean = true;
    private healthState = HealthState.Good;

    private deferredStart = defer();
    private iotcDeviceIdInternal: string = '';
    private iotcModuleIdInternal: string = '';
    private iotcClient: any = null;
    private iotcModuleTwin: any = null;
    private iotcClientConnected: boolean = false;
    private iotcTelemetryThrottleTimer: number = Date.now();
    private iotcPeabodySettingsInternal: IPeabodySettings = {
        hdmiOutput: true,
        inferenceThreshold: defaultConfidenceThreshold,
        detectClass: defaultDetectClass,
        wowzaPlayerLicense: '',
        wowzaPlayerVideoSourceUrl: ''
    };

    public get iotcDeviceId() {
        return this.iotcDeviceIdInternal;
    }

    public get iotcModuleId() {
        return this.iotcModuleIdInternal;
    }

    public get iotcPeabodySettings() {
        return this.iotcPeabodySettingsInternal;
    }

    public async init(): Promise<void> {
        this.logger.log(['IoTCentral', 'info'], 'initialize');

        this.server.method({ name: 'iotCentral.connectToIoTCentral', method: this.connectToIoTCentral });

        this.iotcDeviceIdInternal = this.config.get('IOTEDGE_DEVICEID') || '';
        this.iotcModuleIdInternal = this.config.get('IOTEDGE_MODULEID') || '';
    }

    @bind
    public async connectToIoTCentral(): Promise<void> {
        let result = true;

        try {
            this.logger.log(['IoTCentralService', 'info'], `Starting client connection sequence...`);

            result = await this.connectIotcClient();

            await this.deferredStart.promise;

            this.logger.log(['IoTCentralService', 'info'], `Finished client connection sequence...`);
        }
        catch (ex) {
            result = false;

            this.logger.log(['IoTCentralService', 'error'], `Exception during IoT Central device provsioning: ${ex.message}`);
        }

        this.healthState = result === true ? HealthState.Good : HealthState.Critical;

        this.serviceInitializing = false;
    }

    public async connectIotcClient(): Promise<boolean> {
        let result = true;
        let connectionStatus = `IoT Central successfully connected device: ${this.iotcDeviceIdInternal}`;

        if (this.iotcClient) {
            await this.iotcClient.close();
            this.iotcClient = null;
        }

        try {
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_WORKLOADURI: ${this.config.get('IOTEDGE_WORKLOADURI')}`);
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_DEVICEID: ${this.config.get('IOTEDGE_DEVICEID')}`);
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_MODULEID: ${this.config.get('IOTEDGE_MODULEID')}`);
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_MODULEGENERATIONID: ${this.config.get('IOTEDGE_MODULEGENERATIONID')}`);
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_IOTHUBHOSTNAME: ${this.config.get('IOTEDGE_IOTHUBHOSTNAME')}`);
            this.logger.log(['IoTCentralService', 'info'], `IOTEDGE_AUTHSCHEME: ${this.config.get('IOTEDGE_AUTHSCHEME')}`);

            this.iotcClient = await ModuleClient.fromEnvironment(Mqtt);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Failed to instantiate client interface from configuraiton: ${ex.message}`);
        }

        if (!this.iotcClient) {
            result = false;
        }

        if (result === true) {
            try {
                await this.iotcClient.open();

                this.iotcClient.on('error', this.onIotcClientError);

                this.iotcClient.onMethod(PeabodyModuleFieldIds.Command.StartTrainingMode, this.iotcClientStartTraining);
                this.iotcClient.onMethod(PeabodyModuleFieldIds.Command.SwitchVisionAiModel, this.iotcClientSwitchVisionAiModel);
                this.iotcClient.onMethod(PeabodyModuleFieldIds.Command.RestartDevice, this.iotcClientRestartDevice);

                this.logger.log(['IoTCentralService', 'info'], `Getting twin interface...`);
                this.iotcModuleTwin = await this.iotcClient.getTwin();
                this.logger.log(['IoTCentralService', 'info'], `Connected to module twin...`);

                this.logger.log(['IoTCentralService', 'info'], `Registering for twin updates...`);
                this.iotcModuleTwin.on('properties.desired', this.onHandleModuleProperties);
                this.logger.log(['IoTCentralService', 'info'], `Connected to twin updates...`);

                this.iotcClientConnected = true;

                const systemProperties = await this.getSystemProperties();

                const deviceProperties = {
                    ...this.state.iotCentral.properties,
                    [IoTCentralDeviceFieldIds.Property.OsName]: osPlatform() || '',
                    [IoTCentralDeviceFieldIds.Property.SwVersion]: osRelease() || '',
                    [IoTCentralDeviceFieldIds.Property.ProcessorArchitecture]: osArch() || '',
                    [IoTCentralDeviceFieldIds.Property.ProcessorManufacturer]: systemProperties.cpuModel,
                    [IoTCentralDeviceFieldIds.Property.TotalMemory]: systemProperties.totalMemory
                };
                this.logger.log(['IoTCentralService', 'info'], `Updating device properties: ${JSON.stringify(deviceProperties, null, 4)}`);

                await this.updateDeviceProperties(deviceProperties);
            }
            catch (ex) {
                connectionStatus = `IoT Central connection error: ${ex.message}`;
                this.logger.log(['IoTCentralService', 'error'], connectionStatus);

                result = false;
            }
        }

        return result;
    }

    public async sendInferenceData(inferenceData: any): Promise<void> {
        if (!inferenceData || !this.iotcClientConnected) {
            return;
        }

        if (((Date.now() - this.iotcTelemetryThrottleTimer) < 1000)) {
            return;
        }
        this.iotcTelemetryThrottleTimer = Date.now();

        try {
            await this.sendMeasurement(inferenceData);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `sendInferenceData: ${ex.message}`);
        }
    }

    @bind
    public async sendMeasurement(data: any): Promise<void> {
        if (!data || !this.iotcClientConnected) {
            return;
        }

        try {
            const iotcMessage = new Message(JSON.stringify(data));

            await this.iotcClient.sendEvent(iotcMessage);

            if (_get(process.env, 'DEBUG_TELEMETRY') === '1') {
                this.logger.log(['IoTCentralService', 'info'], `sendEvent: ${JSON.stringify(data, null, 4)}`);
            }
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `sendMeasurement: ${ex.message}`);
        }
    }

    public async updateDeviceProperties(properties: any): Promise<void> {
        if (!properties || !this.iotcClientConnected) {
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                this.iotcModuleTwin.properties.reported.update(properties, (error) => {
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
        return this.healthState;
    }

    public async getSystemProperties(): Promise<ISystemProperties> {
        const cpus = osCpus();
        const cpuUsageSamples = osLoadAvg();

        return {
            cpuModel: Array.isArray(cpus) ? cpus[0].model : '',
            cpuCores: Array.isArray(cpus) ? cpus.length : 0,
            cpuUsage: cpuUsageSamples[0],
            totalMemory: osTotalMem() / 1024,
            freeMemory: osFreeMem() / 1024
        };
    }

    @bind
    private async onHandleModuleProperties(desiredChangedSettings: any) {
        try {
            this.logger.log(['IoTCentralService', 'info'], `Received desiredPropSettings:\n${JSON.stringify(desiredChangedSettings, null, 4)}`);

            let patchedProperties = {};

            for (const setting in desiredChangedSettings) {
                if (!desiredChangedSettings.hasOwnProperty(setting)) {
                    continue;
                }

                if (setting === '$version') {
                    continue;
                }

                const value = _get(desiredChangedSettings, `${setting}.value`);
                if (!value) {
                    this.logger.log(['IoTCentralService', 'info'], `Skipping setting (no value set): ${setting}`);
                    continue;
                }

                let changedSettingResult;

                switch (setting) {
                    case PeabodyModuleFieldIds.Setting.HdmiOutput:
                    case PeabodyModuleFieldIds.Setting.InferenceThreshold:
                    case PeabodyModuleFieldIds.Setting.DetectClass:
                        changedSettingResult = await this.cameraSettingChange(setting, value);
                        break;

                    case PeabodyModuleFieldIds.Setting.WowzaPlayerLicense:
                    case PeabodyModuleFieldIds.Setting.WowzaPlayerVideoSourceUrl:
                        changedSettingResult = await this.clientSettingChange(setting, value);

                        break;

                    default:
                        this.logger.log(['IoTCentralService', 'error'], `Recieved desired property change for unknown setting ${setting}`);
                        break;
                }

                if (_get(changedSettingResult, 'status') === true) {
                    patchedProperties = {
                        ...patchedProperties,
                        [setting]: changedSettingResult.value
                    };
                }
            }

            if (!this.serviceInitializing && !emptyObj(patchedProperties)) {
                const result = await (this.server.methods.camera as any).startCamera();
                if (result === false) {
                    this.iotcPeabodySettingsInternal.hdmiOutput = false;

                    patchedProperties[PeabodyModuleFieldIds.Setting.HdmiOutput] = false;
                }

                await this.updateDeviceProperties(patchedProperties);

                this.subscription.publishUpdateConfiguration();
            }
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Exception while handling desired properties: ${ex.message}`);
        }

        if (this.serviceInitializing) {
            this.deferredStart.resolve();
        }
    }

    private async cameraSettingChange(setting: string, value: any): Promise<any> {
        this.logger.log(['IoTCentralService', 'info'], `Handle camera setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: true
        };

        switch (setting) {
            case PeabodyModuleFieldIds.Setting.HdmiOutput: {
                result.value = this.iotcPeabodySettingsInternal.hdmiOutput = value;
                break;
            }

            case PeabodyModuleFieldIds.Setting.InferenceThreshold:
                result.value = this.iotcPeabodySettingsInternal.inferenceThreshold = value;
                break;

            case PeabodyModuleFieldIds.Setting.DetectClass:
                result.value = this.iotcPeabodySettingsInternal.detectClass = (value as string).toUpperCase();
                break;

            case PeabodyModuleFieldIds.Setting.WowzaPlayerLicense:
                result.value = this.iotcPeabodySettingsInternal.wowzaPlayerLicense = value === 'None' ? '' : value;
                break;

            case PeabodyModuleFieldIds.Setting.WowzaPlayerVideoSourceUrl:
                result.value = this.iotcPeabodySettingsInternal.wowzaPlayerVideoSourceUrl = value === 'None' ? '' : value;
                break;

            default:
                this.logger.log(['IoTCentralService', 'info'], `Unknown camera setting change request ${setting}`);
                result.status = false;
        }

        if (!result.value) {
            result.status = false;
        }

        return result;
    }

    private async clientSettingChange(setting: string, value: any): Promise<{ value: any, status: boolean }> {
        this.logger.log(['IoTCentralService', 'info'], `Handle client setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: true
        };

        switch (setting) {
            case PeabodyModuleFieldIds.Setting.WowzaPlayerLicense:
                result.value = this.iotcPeabodySettingsInternal.wowzaPlayerLicense = value === 'None' ? '' : value;
                break;

            case PeabodyModuleFieldIds.Setting.WowzaPlayerVideoSourceUrl:
                result.value = this.iotcPeabodySettingsInternal.wowzaPlayerVideoSourceUrl = value === 'None' ? '' : value;
                break;

            default:
                this.logger.log(['IoTCentralService', 'info'], `Unknown client setting change request ${setting}`);
                result.status = false;
        }

        return result;
    }

    @bind
    private onIotcClientError(error: Error) {
        this.logger.log(['IoTCentralService', 'error'], `Client connection error: ${error.message}`);
        this.healthState = HealthState.Critical;
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientStartTraining(commandRequest: DeviceMethodRequest, commandResponse: DeviceMethodResponse) {
        this.logger.log(['IoTCentralService', 'info'], `${PeabodyModuleFieldIds.Command.StartTrainingMode} command received`);

        try {
            await commandResponse.send(200);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${PeabodyModuleFieldIds.Command.StartTrainingMode} command: ${ex.message}`);
        }
    }

    @bind
    private async iotcClientSwitchVisionAiModel(commandRequest: DeviceMethodRequest, commandResponse: DeviceMethodResponse) {
        this.logger.log(['IoTCentralService', 'info'], `${PeabodyModuleFieldIds.Command.SwitchVisionAiModel} command received`);
        this.logger.log(['IoTCentralService', 'info'], `${JSON.stringify(commandRequest, null, 4)}`);

        let status = false;

        try {
            const fileUrl = _get(commandRequest, `payload.${SwapModelCommandParams.VisionModelUrl}`);
            if (fileUrl) {
                const result = await (this.server.methods.camera as any).switchVisionAiModel({ type: 'url', fileUrl }) as ICameraResult;
                status = result.status;
            }
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `An exception occurred while trying to switch the vision ai model`);
        }

        await commandResponse.send(status === true ? 200 : 400);
    }

    @bind
    // @ts-ignore (commandRequest)
    private async iotcClientRestartDevice(commandRequest: DeviceMethodRequest, commandResponse: DeviceMethodResponse) {
        this.logger.log(['IoTCentralService', 'info'], `${PeabodyModuleFieldIds.Command.RestartDevice} command received`);

        try {
            await commandResponse.send(200);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${PeabodyModuleFieldIds.Command.RestartDevice} command: ${ex.message}`);
        }

        await (this.server.methods.device as any).restartDevice('IoTCentralService:iotcClientRestartCommand');
    }
}
