import { service, inject } from 'spryly';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as crypto from 'crypto';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StateService } from './state';
import { sleep } from '../utils';

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

    public async init(): Promise<void> {
        this.iotCentralDpsProvisionApiVersion = this.config.get('iotCentralDpsProvisionApiVersion') || defaultIotCentralDpsProvisionApiVersion;
        this.iotCentralDpsAssigningApiVersion = this.config.get('iotCentralDpsAssigningApiVersion') || defaultIotCentralDpsAssigningApiVersion;
        this.iotCentralDpsEndpoint = this.config.get('iotCentralDpsEndpoint') || defaultIotCentralDpsEndpoint;
        this.iotCentralDpsRegistrationSuffix = this.config.get('iotCentralDpsRegistrationSuffix') || defaultIotCentralDpsRegistrationSuffix;
        this.iotCentralDpsOperationsSuffix = this.config.get('iotCentralDpsOperationsSuffix') || defaultIotCentralDpsOperationsSuffix;
        this.iotCentralExpiryHours = this.config.get('iotCentralExpiryHours') || defaultIotCentralExpiryHours;
    }

    public async iotCentralDpsProvisionDevice(): Promise<boolean> {
        this.logger.log(['IoTCentralService', 'info'], `Starting IoT Central provisioning for device: ${this.state.deviceId}`);

        let provisioningStatus = `IoT Central successfully provisioned device ${this.state.deviceId}`;

        try {
            const expiry = (Date.now() - (SECONDS_PER_MINUTE * 5) + (SECONDS_PER_HOUR * Number(this.iotCentralExpiryHours)));
            const sr = `${this.state.scopeId}%2fregistrations%2f${this.state.deviceId}`;
            const sig = this.computDerivedSymmetricKey(this.state.deviceKey, `${sr}\n${expiry}`);

            const options = {
                method: 'PUT',
                url: this.iotCentralDpsEndpoint.replace('###SCOPEID', this.state.scopeId).replace('###DEVICEID', this.state.deviceId)
                    + this.iotCentralDpsRegistrationSuffix.replace('###API_VERSION', this.iotCentralDpsProvisionApiVersion),
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json; charset=utf-8',
                    'Connection': 'keep-alive',
                    'UserAgent': 'prov_device_client/1.0',
                    'Authorization': `SharedAccessSignature sr=${sr}&sig=${encodeURIComponent(sig)}&se=${expiry}&skn=registration`
                },
                body: {
                    registrationId: this.state.deviceId,
                    data: {
                        iotcModelId: this.state.templateId
                    }
                },
                json: true
            };

            let result = await this.iotcRequest(options);

            const operationId = _get(result, 'operationId');

            this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

            delete options.body;
            options.method = 'GET';
            options.url = this.iotCentralDpsEndpoint.replace('###SCOPEID', this.state.scopeId).replace('###DEVICEID', this.state.deviceId)
                + this.iotCentralDpsOperationsSuffix.replace('###OPERATION_ID', operationId).replace('###API_VERSION', this.iotCentralDpsAssigningApiVersion);

            const errorCode = _get(result, 'errorCode');
            if (errorCode) {
                this.logger.log(['IoTCentralService', 'error'], `IoT Central dps provisioning error code: ${errorCode}`);

                return false;
            }

            while (_get(result, 'status') === 'assigning') {
                await sleep(2500);
                this.logger.log(['IoTCentralService', 'info'], `IoT Central dps request succeeded - waiting for hub assignment`);

                result = await this.iotcRequest(options);
            }

            if (_get(result, 'status') === 'assigned') {
                const iotcHub = _get(result, 'registrationState.assignedHub');

                this.logger.log(['IoTCentralService', 'info'], `IoT Central dps hub assignment: ${iotcHub}`);

                await this.state.setIotCentralHubConnectionString(`HostName=${iotcHub};DeviceId=${this.state.deviceId};SharedAccessKey=${this.state.deviceKey}`);

                await this.state.setIotCentralProvisioningStatus(provisioningStatus);

                return true;
            }

            provisioningStatus = `IoT Central dps provisioning error code: ${errorCode}`;
            this.logger.log(['IoTCentralService', 'error'], provisioningStatus);
        }
        catch (ex) {
            provisioningStatus = `IoT Central dps provisioning error: ${ex.message}`;
            this.logger.log(['IoTCentralService', 'error'], provisioningStatus);
        }

        await this.state.setIotCentralProvisioningStatus(provisioningStatus);

        return false;
    }

    private computDerivedSymmetricKey(secret: string, id: string): string {
        const secretBuffer = Buffer.from(secret, 'base64');
        const derivedSymmetricKey = crypto.createHmac('SHA256', secretBuffer).update(id, 'utf8').digest('base64');

        return derivedSymmetricKey;
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
