import { service, inject } from '@sseiber/sprightly';
import { LoggingService } from '../services/logging';
import { CameraService } from '../services/camera';

@service('peabody')
export class PeabodyService {
    @inject('logger')
    private logger: LoggingService;

    @inject('camera')
    private camera: CameraService;

    public async login(): Promise<boolean> {
        return this.camera.login();
    }

    public async logout(): Promise<boolean> {
        return this.camera.logout();
    }

    public async getConfigurationValues(): Promise<any> {
        return this.camera.getConfigurationValues();
    }

    public async reset(): Promise<void> {
        return this.camera.resetCameraServices();
    }

    public async handleTest2() {
        return {
            completed: true,
            body: {
                message: 'test2'
            }
        };
    }
}
