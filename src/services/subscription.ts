import { inject, service } from 'spryly';
import { Server } from '@hapi/hapi';

@service('subscription')
export class SubscriptionService {
    @inject('$server')
    private server: Server;

    public publishHealth(health: any) {
        this.server.publish(`/api/v1/subscription/inference`, health);
    }

    public publishInference(inference: any) {
        this.server.publish(`/api/v1/subscription/inference`, inference);
    }
}
