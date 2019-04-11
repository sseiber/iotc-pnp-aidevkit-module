import { service, inject } from 'spryly';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { sleep, bind } from '../utils';
import * as AzureIotDeviceMqtt from 'azure-iot-device-mqtt';
import * as AzureIotDevice from 'azure-iot-device';

export const DeviceTelemetry = {
    Inference: 'telemetry_inference'
};

export const DeviceState = {
    InferenceProcessor: 'state_inference_processor',
    Session: 'state_session'
};

export const DeviceEvent = {
    SessionLogin: 'event_session_login',
    SessionLogout: 'event_session_logout',
    InferenceProcessingStarted: 'event_inference_processing_started',
    InferenceProcessingStopped: 'event_inference_proessing_stopped',
    DeviceRestart: 'event_device_restart'
};

export const DeviceSetting = {
    HdmiOutput: 'setting_hdmi_output',
    Bitrate: 'setting_bitrate',
    Encoder: 'setting_encoder',
    Fps: 'setting_fps',
    Resolution: 'setting_resolution'
};

export const DeviceProperty = {
    IpAddress: 'prop_ip_address',
    RtspVideoUrl: 'prop_rtsp_video_url',
    RtspDataUrl: 'prop_rtsp_data_url'
};

const SECONDS_PER_MINUTE: number = (60);
const SECONDS_PER_HOUR: number = (60 * 60);

const defaultIotCentralDpsProvisionApiVersion: string = '2019-01-15';
const defaultIotCentralDpsAssigningApiVersion: string = '2018-11-01';
const defaultIotCentralDpsEndpoint: string = 'https://global.azure-devices-provisioning.net/###SCOPEID/registrations/###DEVICEID';
const defaultIotCentralDpsRegistrationSuffix: string = '/register?api-version=###API_VERSION';
const defaultIotCentralDpsOperationsSuffix: string = '/operations/###OPERATION_ID?api-version=###API_VERSION';
const defaultIotCentralExpiryHours: string = '2';

@service('iotCentral')
export class IoTCentralService {
    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('state')
    private state: StateService;

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
    private iotcClientSendMeasurement: any = null;
    private iotcClientUpdateProperties: any = null;
    private iotcClientConnected: boolean = false;

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
        this.iotCentralDpsProvisionApiVersion = this.config.get('iotCentralDpsProvisionApiVersion') || defaultIotCentralDpsProvisionApiVersion;
        this.iotCentralDpsAssigningApiVersion = this.config.get('iotCentralDpsAssigningApiVersion') || defaultIotCentralDpsAssigningApiVersion;
        this.iotCentralDpsEndpoint = this.config.get('iotCentralDpsEndpoint') || defaultIotCentralDpsEndpoint;
        this.iotCentralDpsRegistrationSuffix = this.config.get('iotCentralDpsRegistrationSuffix') || defaultIotCentralDpsRegistrationSuffix;
        this.iotCentralDpsOperationsSuffix = this.config.get('iotCentralDpsOperationsSuffix') || defaultIotCentralDpsOperationsSuffix;
        this.iotCentralExpiryHours = this.config.get('iotCentralExpiryHours') || defaultIotCentralExpiryHours;
    }

    public async iotCentralDpsProvisionDevice(): Promise<boolean> {
        const iotCentralState = this.state.iotCentral;
        let result = true;
        let provisioningStatus = `IoT Central successfully provisioned device: ${iotCentralState.deviceId}`;

        try {
            this.logger.log(['IoTCentralService', 'info'], `Starting IoT Central provisioning for device: ${iotCentralState.deviceId}`);

            const expiry = (Date.now() - (SECONDS_PER_MINUTE * 5) + (SECONDS_PER_HOUR * Number(this.iotCentralExpiryHours)));
            const sr = `${iotCentralState.scopeId}%2fregistrations%2f${iotCentralState.deviceId}`;
            const sig = this.computDerivedSymmetricKey(iotCentralState.deviceKey, `${sr}\n${expiry}`);

            const options = {
                method: 'PUT',
                url: this.iotCentralDpsEndpoint.replace('###SCOPEID', iotCentralState.scopeId).replace('###DEVICEID', iotCentralState.deviceId)
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
                        iotcModelId: `${iotCentralState.templateId}/${iotCentralState.templateVersion}`
                    }
                },
                json: true
            };

            let response = await this.iotcRequest(options);

            const operationId = _get(response, 'operationId');

            this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

            delete options.body;
            options.method = 'GET';
            options.url = this.iotCentralDpsEndpoint.replace('###SCOPEID', iotCentralState.scopeId).replace('###DEVICEID', iotCentralState.deviceId)
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

    public async connectIotcClient(liveProperties: any): Promise<boolean> {
        let result = true;
        let connectionStatus = `IoT Central successfully connected device: ${this.state.iotCentral.deviceId}`;

        this.iotcClient = AzureIotDeviceMqtt.clientFromConnectionString(this.iotCentralHubConnectionString);
        if (!this.iotcClient) {
            result = false;
        }

        if (result === true) {
            try {
                await promisify(this.iotcClient.open.bind(this.iotcClient))();

                this.iotcClient.on('error', this.onIotcClientError);

                this.iotcClient.onDeviceMethod('start_training_mode', this.iotcClientStartTraining);

                this.iotcDeviceTwin = await promisify(this.iotcClient.getTwin.bind(this.iotcClient))();

                this.iotcClientSendMeasurement = promisify(this.iotcClient.sendEvent.bind(this.iotcClient));
                this.iotcClientUpdateProperties = promisify(this.iotcDeviceTwin.properties.reported.update.bind(this.iotcDeviceTwin.properties.reported));

                this.iotcClientConnected = true;

                await this.iotcClientSendDeviceProperties({
                    ...this.state.iotCentral.properties,
                    ...liveProperties
                });
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
    public async sendMeasurement(measurementType: string, data: any) {
        if (!data || !this.iotcClientConnected) {
            return;
        }

        const iotcMessage = new AzureIotDevice.Message(JSON.stringify(data));

        try {
            await this.iotcClientSendMeasurement(iotcMessage);

            this.logger.log(['IoTCentralService', 'info'], `Device ${measurementType} telemmetry sent`);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `sendMeasurement: ${ex.message}`);
        }
    }

    public async iotcClientSendDeviceProperties(properties: any) {
        if (!properties || !this.iotcClientConnected) {
            return;
        }

        try {
            await this.iotcClientUpdateProperties(properties);

            this.logger.log(['IoTCentralService', 'info'], `Device live properties updated`);
        }
        catch (ex) {
            this.logger.log(['IoTCentralService', 'error'], `Error while updating client properties: ${ex.message}`);
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
    }

    @bind
    // @ts-ignore (request)
    private async iotcClientStartTraining(clientRequest: any, clientResponse: any) {
        this.logger.log(['IoTCentralService', 'error'], `Client start training command received`);

        // @ts-ignore (error)
        // tslint:disable-next-line:no-empty
        clientResponse.send(10, 'Success', (error) => { });
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
