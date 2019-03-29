
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { AuthService } from './auth';
import { StorageService } from './storage';
import { StateService } from './state';
import { FileHandlerService } from './fileHandler';
import { SubscriptionService } from './subscription';
import { PeabodyProxyService } from './peabodyProxy';
import { CameraService } from './camera';
import { DataStreamController } from './dataStreamProcessor';
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
    DataStreamController,
    IoTCentralService
];
