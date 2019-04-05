
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { AuthService } from './auth';
import { StorageService } from './storage';
import { StateService } from './state';
import { FileHandlerService } from './fileHandler';
import { SubscriptionService } from './subscription';
import { PeabodyProxyService } from './peabodyProxy';
import { CameraService } from './camera';
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
    FileHandlerService,
    SubscriptionService,
    PeabodyProxyService,
    CameraService,
    InferenceProcessorService,
    DataStreamController,
    VideoStreamController,
    IoTCentralService
];
