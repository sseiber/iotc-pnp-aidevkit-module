
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { AuthService } from './auth';
import { StorageService } from './storage';
import { StateService } from './state';
import { PeabodyProxyService } from './peabodyProxy';
import { CameraService } from './camera';

export default [
    ConfigService,
    LoggingService,
    AuthService,
    StorageService,
    StateService,
    PeabodyProxyService,
    CameraService
];
