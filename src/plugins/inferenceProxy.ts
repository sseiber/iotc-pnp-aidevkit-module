import { HapiPlugin } from 'spryly';
import { Server } from 'hapi';
import * as Nes from 'nes';

export class InferenceProxyPlugin implements HapiPlugin {
    public async register(server: Server) {
        await server.register(Nes);

        server.subscription('/api/v1/subscription/up');
        server.subscription('/api/v1/subscription/restart');
        server.subscription('/api/v1/subscription/health');
        server.subscription('/api/v1/subscription/inference');
        server.subscription('/api/v1/subscription/model');
    }
}
