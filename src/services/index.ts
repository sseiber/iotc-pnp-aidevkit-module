
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { AuthService } from './auth';
import { StorageService } from './storage';
import { StateService } from './state';
import { DeviceService } from './device';
import { SubscriptionService } from './subscription';
import { CameraService } from './camera';
import { HealthService } from './health';
import { InferenceProcessorService } from './inferenceProcessor';
import { DataStreamController } from './dataStreamProcessor';
import { VideoStreamController } from './videoStreamProcessor';
import { IoTCentralService } from './iotcentral';

export default [
    ConfigService,
    LoggingService,
    AuthService,
    StorageService,
    StateService,
    DeviceService,
    SubscriptionService,
    CameraService,
    HealthService,
    InferenceProcessorService,
    DataStreamController,
    VideoStreamController,
    IoTCentralService
];
