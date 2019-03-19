const ROOT = '__ROOT__';
import { service, inject } from '@sseiber/sprightly';
import { Server } from 'hapi';
import { LoggingService } from './logging';
import { promisify } from 'util';
import * as fse from 'fs-extra';
import { join as pathJoin } from 'path';
import { readFile, writeFile } from 'jsonfile';
import * as _get from 'lodash.get';
import * as _set from 'lodash.set';

@service('storage')
export class StorageService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    private setupDone;
    private storageDirectory;

    public async init() {
        this.logger.log(['StorageService', 'info'], 'initialize');

        this.storageDirectory = pathJoin((this.server.settings.app as any).peabodyDirectory, 'peabody', 'storage');

        this.setup();
    }

    public async get(scope: string, property?: string) {
        if (!property) {
            property = ROOT;
        }

        const obj = await this.readScope(scope);

        if (!obj) {
            return null;
        }

        if (property === ROOT) {
            return obj;
        }

        return _get(obj, property);
    }

    public async set(scope: string, property: any, value?: any) {
        if (!value) {
            value = property;
            property = ROOT;
        }

        const obj = await this.readScope(scope);

        const finalObject = (property === ROOT)
            ? value
            : _set(obj || {}, property, value);

        return this.writeScope(scope, finalObject);
    }

    public async flush(scope: string, property: string, value?: any) {
        if (!value) {
            value = property;
            property = ROOT;
        }

        const finalObject = (property === ROOT)
            ? value
            : _set({}, property, value);

        return this.writeScope(scope, finalObject);
    }

    private async setup() {
        if (this.setupDone === true) {
            return;
        }

        await fse.ensureDir(this.storageDirectory);

        this.setupDone = true;
    }

    // TODO:
    // read/write scope and file tests may need to be synchronous
    private async readScope(scope) {
        try {
            await this.setup();

            const exists = await fse.exists(this.getScopePath(scope));
            if (!exists) {
                return null;
            }

            return promisify(readFile)(this.getScopePath(scope), { throws: false });
        }
        catch (error) {
            return null;
        }
    }

    private async writeScope(scope, data) {
        await this.setup();

        const writeOptions = {
            spaces: 2,
            throws: false
        };

        return promisify(writeFile)(this.getScopePath(scope), data, writeOptions);
    }

    private getScopePath(scope) {
        return pathJoin(this.storageDirectory, `${scope}.json`);
    }
}
