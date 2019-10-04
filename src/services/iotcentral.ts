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
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fse from 'fs-extra';
import { SubscriptionService } from './subscription';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { bind, forget, defer } from '../utils';
import { HealthState } from './health';
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
    usedMemory: number;
}

export interface IIotcCameraProperties {
    hdmiOutput: boolean;
    wowzaPlayerLicense: string;
    wowzaPlayerVideoSourceUrl: string;
}

export interface IIotcVisionProperties {
    inferenceThreshold: number;
    detectClass: string;
}

export const IoTCentralDeviceFieldIds = {
    Properties: {
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

export enum PeabodyDeviceInferenceProcessorState {
    Inactive = 'inactive',
    Active = 'active'
}

export enum PeabodyDeviceSessionState {
    Inactive = 'inactive',
    Active = 'active'
}

export enum DeviceCommandParams {
    VisionModelUrl = 'cmParamVisionModelUrl'
}

export const PeabodyDeviceFieldIds = {
    Telemetry: {
        CameraSystemHeartbeat: 'tlCameraSystemHeartbeat',
        Detections: 'tlDetectionCount',
        AllDetections: 'tlAllDetectionsCount',
        BatteryLevel: 'tlBatteryLevel'
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
const defaultDetectClass: string = 'person';

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
    private iotcCameraPropertiesInternal: IIotcCameraProperties = {
        hdmiOutput: true,
        wowzaPlayerLicense: '',
        wowzaPlayerVideoSourceUrl: ''
    };
    private iotcVisionPropertiesInternal: IIotcVisionProperties = {
        inferenceThreshold: defaultConfidenceThreshold,
        detectClass: defaultDetectClass
    };

    public get iotcDeviceId() {
        return this.iotcDeviceIdInternal;
    }

    public get iotcModuleId() {
        return this.iotcModuleIdInternal;
    }

    public get iotcCameraProperties() {
        return this.iotcCameraPropertiesInternal;
    }

    public get iotcVisionProperties() {
        return this.iotcVisionPropertiesInternal;
    }

    public async init(): Promise<void> {
        this.logger.log(['IoTCentral', 'info'], 'initialize');

        this.server.method({ name: 'iotCentral.connectToIoTCentral', method: this.connectToIoTCentral });

        this.iotcDeviceIdInternal = this.config.get('IOTEDGE_DEVICEID') || '';
        this.iotcModuleIdInternal = this.config.get('IOTEDGE_MODULEID') || '';

        this.iotcCameraPropertiesInternal.wowzaPlayerLicense = this.config.get('cloudWowzaPlayerLicense') || '';
        this.iotcCameraPropertiesInternal.wowzaPlayerVideoSourceUrl = this.config.get('cloudWowzaPlayerVideoSourceUrl') || '';
    }

    @bind
    public async connectToIoTCentral(): Promise<void> {
        let result = true;

        try {
            result = await this.connectIotcClient();

            await this.deferredStart.promise;
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

            // tslint:disable-next-line:prefer-conditional-expression
            if (_get(process.env, 'LOCAL_DEBUG') === '1') {
                this.iotcClient = ModuleClient.fromConnectionString(this.config.get('iotCentralModuleConnectionString') || '', Mqtt);
            }
            else {
                this.iotcClient = await ModuleClient.fromEnvironment(Mqtt);
            }
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

                this.iotcClient.onMethod(PeabodyDeviceFieldIds.Command.StartTrainingMode, this.iotcClientStartTraining);
                this.iotcClient.onMethod(PeabodyDeviceFieldIds.Command.SwitchVisionAiModel, this.iotcClientSwitchVisionAiModel);
                this.iotcClient.onMethod(PeabodyDeviceFieldIds.Command.RestartDevice, this.iotcClientRestartDevice);

                this.logger.log(['IoTCentralService', 'info'], `Getting twin interface...`);
                this.iotcModuleTwin = await this.iotcClient.getTwinAsync();
                this.logger.log(['IoTCentralService', 'info'], `Connected to module twin...`);

                this.logger.log(['IoTCentralService', 'info'], `Registering for twin updates...`);
                this.iotcModuleTwin.on('properties.desired', this.onHandleDeviceProperties);
                this.logger.log(['IoTCentralService', 'info'], `Connected to twin updates...`);

                this.iotcClientConnected = true;

                const systemProperties = await this.getSystemProperties();

                const deviceProperties = {
                    ...this.state.iotCentral.properties,
                    [IoTCentralDeviceFieldIds.Properties.OsName]: osPlatform() || '',
                    [IoTCentralDeviceFieldIds.Properties.SwVersion]: osRelease() || '',
                    [IoTCentralDeviceFieldIds.Properties.ProcessorArchitecture]: osArch() || '',
                    [IoTCentralDeviceFieldIds.Properties.ProcessorManufacturer]: systemProperties.cpuModel,
                    [IoTCentralDeviceFieldIds.Properties.TotalMemory]: systemProperties.totalMemory
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

    @bind
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

        if (_get(process.env, 'LOCAL_DEBUG') === '1') {
            const nodeTotalMemory = osTotalMem() / 1024;
            const nodeUsedMemory = nodeTotalMemory - (osFreeMem() / 1024);
            return {
                cpuModel: Array.isArray(cpus) ? cpus[0].model : '',
                cpuCores: Array.isArray(cpus) ? cpus.length : 0,
                cpuUsage: cpuUsageSamples[0],
                totalMemory: nodeTotalMemory,
                usedMemory: nodeUsedMemory
            };
        }

        let totalMemory = 0;
        let usedMemory = 0;

        try {
            const { stdout } = await promisify(exec)(`cat /proc/meminfo | awk '/MemTotal:/{print $2}'`);
            totalMemory = Number((stdout || '0').trim());
        }
        catch (ex) {
            this.logger.log(['RTCVService', 'error'], `Exception while accessing /proc/meminfo: ${ex.message}`);
        }

        try {
            const usedMemorySample = await fse.readFile('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8');
            usedMemory = Number((usedMemorySample || '0').trim()) / 1024;
        }
        catch (ex) {
            this.logger.log(['RTCVService', 'error'], `Exception while accessing /sys/fs/cgroup/memory: ${ex.message}`);
        }

        return {
            cpuModel: Array.isArray(cpus) ? cpus[0].model : '',
            cpuCores: Array.isArray(cpus) ? cpus.length : 0,
            cpuUsage: cpuUsageSamples[0],
            totalMemory,
            usedMemory
        };
    }

    @bind
    private async onHandleDeviceProperties(desiredChangedSettings: any) {
        try {
            this.logger.log(['IoTCentralService', 'info'], `Received desiredPropSettings:\n${JSON.stringify(desiredChangedSettings, null, 4)}`);
            for (const setting in desiredChangedSettings) {
                if (!desiredChangedSettings.hasOwnProperty(setting)) {
                    continue;
                }

                if (setting === '$version') {
                    continue;
                }

                const prop = desiredChangedSettings[setting];
                // if (!prop.hasOwnProperty('value')) {
                //     continue;
                // }

                const value = prop.value;
                let changedSettingResult;

                switch (setting) {
                    case PeabodyDeviceFieldIds.Setting.HdmiOutput:
                    case PeabodyDeviceFieldIds.Setting.WowzaPlayerLicense:
                    case PeabodyDeviceFieldIds.Setting.WowzaPlayerVideoSourceUrl:
                        changedSettingResult = await this.cameraSettingChange(setting, value);
                        break;

                    case PeabodyDeviceFieldIds.Setting.InferenceThreshold:
                    case PeabodyDeviceFieldIds.Setting.DetectClass:
                        changedSettingResult = await this.visionSettingChange(setting, value);
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

            if (!this.serviceInitializing) {
                forget((this.server.methods.rtcv as any).startPipeline);
                this.subscription.publishUpdateConfiguration();
            }
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Exception while handling desired properties: ${ex.message}`);
        }

        this.deferredStart.resolve();
    }

    @bind
    private async cameraSettingChange(setting: string, value: any): Promise<any> {
        this.logger.log(['IoTCentralService', 'info'], `Handle camera setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: 'completed'
        };

        switch (setting) {
            case PeabodyDeviceFieldIds.Setting.HdmiOutput:
                this.iotcCameraPropertiesInternal.hdmiOutput = value;
                result.value = await (this.server.methods.camera as any).switchHdmiOutput(value);
                break;

            case PeabodyDeviceFieldIds.Setting.WowzaPlayerLicense:
                this.iotcCameraPropertiesInternal.wowzaPlayerLicense = value === 'None' ? '' : value;
                break;

            case PeabodyDeviceFieldIds.Setting.WowzaPlayerVideoSourceUrl:
                this.iotcCameraPropertiesInternal.wowzaPlayerVideoSourceUrl = value === 'None' ? '' : value;
                break;

            default:
                this.logger.log(['IoTCentralService', 'info'], `Unknown camera setting change request ${setting}`);
                result.status = 'error';
        }

        if (!result.value) {
            result.status = 'error';
        }

        return result;
    }

    @bind
    private async visionSettingChange(setting: string, value: any): Promise<any> {
        this.logger.log(['IoTCentralService', 'info'], `Handle vision setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: 'completed'
        };

        switch (setting) {
            case PeabodyDeviceFieldIds.Setting.InferenceThreshold:
                this.iotcVisionPropertiesInternal.inferenceThreshold = value;
                break;

            case PeabodyDeviceFieldIds.Setting.DetectClass:
                this.iotcVisionPropertiesInternal.detectClass = value;
                break;

            default:
                this.logger.log(['IoTCentralService', 'info'], `Unknown vision setting change request ${setting}`);
                result.status = 'error';
        }

        if (!result.value) {
            result.status = 'error';
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
        this.logger.log(['IoTCentralService', 'error'], `${PeabodyDeviceFieldIds.Command.StartTrainingMode} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${PeabodyDeviceFieldIds.Command.StartTrainingMode} command: ${error.toString()}`);
            }
        });
    }

    @bind
    private async iotcClientSwitchVisionAiModel(iotcRequest: DeviceMethodRequest, iotcResponse: DeviceMethodResponse) {
        this.logger.log(['IoTCentralService', 'error'], `${PeabodyDeviceFieldIds.Command.SwitchVisionAiModel} command received`);

        const fileUrl = _get(iotcRequest, `payload.${DeviceCommandParams.VisionModelUrl}`);

        iotcResponse.send(fileUrl ? 200 : 400, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${PeabodyDeviceFieldIds.Command.StartTrainingMode} command: ${error.toString()}`);
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
    private async iotcClientRestartDevice(commandRequest: DeviceMethodRequest, commandResponse: DeviceMethodResponse) {
        this.logger.log(['IoTCentralService', 'error'], `${PeabodyDeviceFieldIds.Command.RestartDevice} command received`);

        commandResponse.send(200, (error) => {
            if (error) {
                this.logger.log(['IoTCentralService', 'error'], `Error sending response for ${PeabodyDeviceFieldIds.Command.StartTrainingMode} command: ${error.toString()}`);
            }
        });

        await (this.server.methods.device as any).restartDevice('IoTCentralService:iotcClientRestartCommand');
    }
}
