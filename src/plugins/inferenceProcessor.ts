import { HapiPlugin } from 'spryly';
import { Server } from '@hapi/hapi';
import * as Nes from '@hapi/nes';

export class InferenceProcessorPlugin implements HapiPlugin {
    public async register(server: Server) {
        await server.register(Nes);

        server.subscription('/api/v1/subscription/up');
        server.subscription('/api/v1/subscription/restart');
        server.subscription('/api/v1/subscription/health');
        server.subscription('/api/v1/subscription/inference');
        server.subscription('/api/v1/subscription/model');
    }
}
