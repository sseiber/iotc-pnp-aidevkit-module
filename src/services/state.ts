import { service, inject } from '@sseiber/sprightly';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { StorageService } from './storage';
import * as _get from 'lodash.get';

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

        this.stateFile = this.config.get('serviceSettings_systemName') ? `${this.config.get('serviceSettings_systemName')}-state` : 'state';

        await this.loadState();
    }

    public get systemName(): string {
        return this.stateInternal.registration.systemName;
    }

    public get systemId(): string {
        return this.stateInternal.registration.systemId;
    }

    public get setupToken(): string {
        return this.stateInternal.setupToken || '';
    }

    public async setConfiguration(configOptions: any) {
        const setStateError = 1;
        if (setStateError) {
            throw setStateError;
        }

        await this.flushState();
    }

    private async loadState() {
        this.stateInternal = await this.storage.get(this.stateFile);
        this.stateInternal.editContext = Date.now();

        await this.flushState();
    }

    private async flushState() {
        try {
            await this.storage.flush(this.stateFile, this.stateInternal as any);
        }
        catch (error) {
            this.logger.log(['flushState', 'error'], error.message);

            // eat exeptions
        }
    }
}
