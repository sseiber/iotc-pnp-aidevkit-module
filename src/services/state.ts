import { service, inject } from 'spryly';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StorageService } from './storage';
import * as _get from 'lodash.get';
import { v4 as uuidV4 } from 'uuid';

@service('state')
export class StateService {
    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('storage')
    private storage: StorageService;

    private stateInternal: any;
    private stateFile;

    public get state(): any {
        return this.stateInternal;
    }

    public async init() {
        this.logger.log(['StateService', 'info'], 'initialize');

        this.stateFile = this.config.get('systemName') ? `${this.config.get('systemName')}-state` : 'state';

        await this.loadState();

        if (!this.systemName) {
            this.stateInternal.registration.systemName = uuidV4();
        }

        if (!this.systemId) {
            this.stateInternal.registration.systemId = uuidV4();
        }

        await this.flushState();
    }

    public get systemName(): string {
        return this.stateInternal.registration.systemName;
    }

    public get systemId(): string {
        return this.stateInternal.registration.systemId;
    }

    public get deviceId(): string {
        return this.stateInternal.registration.deviceId || '';
    }

    public get scopeId(): string {
        return this.stateInternal.registration.scopeId || '';
    }

    public get deviceKey(): string {
        return this.stateInternal.registration.deviceKey || '';
    }

    public get templateId(): string {
        return this.stateInternal.registration.templateId || '';
    }

    public get ioTCentralHubConnectionString(): string {
        return this.stateInternal.registration.ioTCentralHubConnectionString || '';
    }

    public async setIoTCentralHubConnectionString(connectionString: string) {
        this.stateInternal.registration.ioTCentralHubConnectionString = connectionString;

        await this.flushState();
    }

    private async loadState() {
        try {
            this.stateInternal = await this.storage.get(this.stateFile);
            if (!this.stateInternal) {
                this.stateInternal = {
                    registration: {
                        systemName: '',
                        systemId: ''
                    }
                };
            }

            await this.flushState();
        }
        catch (ex) {
            this.logger.log(['flushState', 'error'], ex.message);

            // eat exeptions
        }
    }

    private async flushState() {
        try {
            await this.storage.flush(this.stateFile, this.stateInternal as any);
        }
        catch (ex) {
            this.logger.log(['flushState', 'error'], ex.message);

            // eat exeptions
        }
    }
}
