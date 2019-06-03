import { inject, HapiPlugin } from 'spryly';
import { Server } from '@hapi/hapi';
import { Subscription, SocketService } from '../services/socket';
import * as Nes from '@hapi/nes';

export class SocketPlugin implements HapiPlugin {
    @inject('socketService')
    private socketService: SocketService;

    public async register(server: Server) {
        await server.register({
            plugin: Nes,
            options: {
                onConnection: this.socketService.onConnect.bind(this.socketService),
                onDisconnection: this.socketService.onDisconnect.bind(this.socketService),
                auth: false,
                heartbeat: {
                    interval: 10000,
                    timeout: 5000
                }
            }
        });

        server.subscription(Subscription.ServerUp);
        server.subscription(Subscription.Restart);
        server.subscription(Subscription.Health);
        server.subscription(Subscription.Inference);
        server.subscription(Subscription.ModelChange);
        server.subscription(Subscription.VideoStreamUp);
        server.subscription(Subscription.VideoStreamDown);
        server.subscription(Subscription.VideoStreamData);
    }
}
