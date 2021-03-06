import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { CameraService } from './camera';
import * as _get from 'lodash.get';

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

        // Workaround:
        // IoT Edge runtime 1.0.7.x has an incompatibility with Dockerfile HEALTHCHECK configurations
        // Microsoft Vision AI Dev Kit firmware version v0.4940_Perf uses IoT Edge runtime version 1.0.7.x
        // Newer versions of the Dev Kit should contain IoT Edge runtime 1.0.8+ which contains a fix for
        // this issue. On those versions you can uncomment the HEALTHCHECK configuration in the Dockerfile
        // and rebuild this container and remove the FORCE_HEALTHCHECK environment variable in your
        // IoT Edge deployment manifest.
        if (_get(process.env, 'LOCAL_DEBUG') === '1' || _get(process.env, 'FORCE_HEALTHCHECK') === '1') {
            setInterval(async () => {
                const cameraHealth = await this.checkHealthState();

                if (cameraHealth < HealthState.Good) {
                    if ((Date.now() - this.heathCheckStartTime) > (1000 * healthCheckStartPeriod) && ++this.failingStreak >= healthCheckRetries) {
                        await(this.server.methods.device as any).restartDevice('HealthService:checkHealthState');
                    }
                }
                else {
                    this.heathCheckStartTime = Date.now();
                    this.failingStreak = 0;
                }
            }, (1000 * healthCheckInterval));
        }
    }

    public async checkHealthState(): Promise<number> {
        const cameraHealth = await this.camera.getHealth();

        if (cameraHealth < HealthState.Good) {
            this.logger.log(['HealthService', 'warning'], `Health check watch: camera:${cameraHealth}`);
        }

        return cameraHealth;
    }
}
