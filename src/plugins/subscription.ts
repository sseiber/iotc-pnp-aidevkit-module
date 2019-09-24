import { HapiPlugin } from 'spryly';
import { Server } from '@hapi/hapi';
import { SocketSubscriptions } from '../services/subscription';
import * as Nes from '@hapi/nes';

export class SubscriptionPlugin implements HapiPlugin {
    public async register(server: Server) {
        await server.register(Nes);

        server.subscription(SocketSubscriptions.Health);
        server.subscription(SocketSubscriptions.Inference);
        server.subscription(SocketSubscriptions.Model);
        server.subscription(SocketSubscriptions.UpdateConfiguration);
    }
}
