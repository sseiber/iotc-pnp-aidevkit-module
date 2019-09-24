import { inject, service } from 'spryly';
import { Server } from '@hapi/hapi';

export const SocketSubscriptions = {
    Health: '/subscription/health',
    Inference: '/subscription/inference',
    Model: '/subscription/model',
    CreateSession: '/subscription/createsession',
    DestroySession: '/subscription/destroysession',
    UpdateConfiguration: '/subscription/updateconfiguration'
};

@service('subscription')
export class SubscriptionService {
    @inject('$server')
    private server: Server;

    public publishHealth(health: any) {
        this.server.publish(SocketSubscriptions.Health, health);
    }

    public publishInference(inference: any) {
        this.server.publish(SocketSubscriptions.Inference, inference);
    }

    public publishModel(modelFile: any) {
        this.server.publish(SocketSubscriptions.Model, modelFile);
    }

    public publishCreateSession() {
        this.server.publish(SocketSubscriptions.CreateSession, {});
    }

    public publishDestroySession() {
        this.server.publish(SocketSubscriptions.DestroySession, {});
    }

    public publishUpdateConfiguration() {
        this.server.publish(SocketSubscriptions.UpdateConfiguration, {});
    }
}
