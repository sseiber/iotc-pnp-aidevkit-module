
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { AuthService } from './auth';
import { StorageService } from './storage';
import { StateService } from './state';
import { PeabodyProxyService } from './peabodyProxy';
import { CameraService } from './camera';
import { DataStreamController } from './dataStreamProcessor';

export default [
    ConfigService,
    LoggingService,
    AuthService,
    StorageService,
    StateService,
    PeabodyProxyService,
    CameraService,
    DataStreamController
];
