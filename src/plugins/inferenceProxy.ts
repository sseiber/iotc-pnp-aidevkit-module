import { HapiPlugin } from '@sseiber/sprightly';
import { Server } from 'hapi';
import * as Nes from 'nes';

export class InferenceProxyPlugin implements HapiPlugin {
    public async register(server: Server) {
        await server.register(Nes);

        server.subscription('/api/v1/inference');
    }
}
