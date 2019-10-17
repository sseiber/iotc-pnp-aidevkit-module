import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { CameraService } from './camera';
import * as _get from 'lodash.get';
import { bind, forget } from '../utils';

export const healthCheckInterval = 15;
// const healthCheckTimeout = 30;
const healthCheckStartPeriod = 60;
const healthCheckRetries = 3;

export const HealthState = {
    Good: 1,
    Warning: 0,
    Critical: 0
};

@service('health')
export class HealthService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('camera')
    private camera: CameraService;

    private heathCheckStartTime = Date.now();
    private failingStreak = 1;

    public async init() {
        this.logger.log(['HealthService', 'info'], 'initialize');

        if (_get(process.env, 'LOCAL_DEBUG') === '1' || _get(process.env, 'FORCE_HEALTHCHECK') === '1') {
            setInterval(() => {
                forget(this.checkHealthState);
            }, (1000 * healthCheckInterval));
        }
    }

    @bind
    public async checkHealthState(): Promise<number> {
        const cameraHealth = await this.camera.getHealth();

        if (cameraHealth < HealthState.Good) {
            this.logger.log(['HealthService', 'warning'], `Health check watch: camera:${cameraHealth}`);

            if ((Date.now() - this.heathCheckStartTime) > (1000 * healthCheckStartPeriod) && ++this.failingStreak >= healthCheckRetries) {
                await (this.server.methods.device as any).restartDevice('HealthService:checkHealthState');
            }
        }

        return cameraHealth;
    }
}
