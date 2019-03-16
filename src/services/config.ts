import { service } from '@sseiber/sprightly';
import * as nconf from 'nconf';

@service('config')
export class ConfigService {
    private config: nconf.Provider;

    public async init() {
        this.config = nconf.env().file(`./configs/${process.env.NODE_ENV}.json`);
    }

    public get(key: string): any {
        return this.config.get(key);
    }
}
