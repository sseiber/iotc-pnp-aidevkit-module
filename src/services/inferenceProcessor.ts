import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { Subscription } from '../services/socket';
import { DataStreamController } from '../services/dataStreamProcessor';
import { IoTCentralService, DeviceEvent, DeviceSetting, DeviceTelemetry } from '../services/iotcentral';
import { bind } from '../utils';
import * as _get from 'lodash.get';

const defaultConfidenceThreshold: number = 70;

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('dataStreamController')
    private dataStreamController: DataStreamController;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private inferenceCount: number = 0;
    private confidenceThreshold: number = defaultConfidenceThreshold;
    private detectClass: string = 'person';

    public async init(): Promise<void> {
        this.logger.log(['InferenceProcessor', 'info'], 'initialize');

        this.server.method({ name: 'inferenceProcessor.inferenceSettingChange', method: this.handleInferenceSettingChange });
        this.server.method({ name: 'inferenceProcessor.dataInference', method: this.handleDataInference });

        this.confidenceThreshold = Number(this.config.get('confidenceThreshold')) || defaultConfidenceThreshold;
    }

    public async startInferenceProcessor(rtspDataUrl: string) {
        return this.dataStreamController.startDataStreamProcessor(rtspDataUrl);
    }

    public stopInferenceProcessor() {
        this.dataStreamController.stopDataStreamProcessor();
    }

    @bind
    public async handleDataInference(inference: any) {
        const inferences = _get(inference, 'objects');

        if (inferences && Array.isArray(inferences)) {
            for (const inferenceItem of inferences) {
                if (_get(inferenceItem, 'display_name') !== 'Negative') {
                    this.logger.log(['InferenceProcessor', 'info'], `Inference: `
                        + `id:${_get(inferenceItem, 'id')} `
                        + `"${_get(inferenceItem, 'display_name')}" `
                        + `${_get(inferenceItem, 'confidence')}% `);
                }
            }

            const publishedInferences = inferences.reduce((publishedItems, inferenceItem) => {
                const confidence = Number(_get(inferenceItem, 'confidence') || 0);
                if (_get(inferenceItem, 'display_name') !== 'Negative' && confidence >= this.confidenceThreshold) {
                    publishedItems.push({
                        count: this.inferenceCount++,
                        ...inferenceItem
                    });
                }

                return publishedItems;
            }, []);

            if (publishedInferences.length > 0) {
                await this.publishInference({
                    timestamp: Date.now(),
                    inferences: publishedInferences
                });
            }
        }
    }

    public async getHealth(): Promise<number> {
        return this.dataStreamController.getHealth();
    }

    @bind
    private async handleInferenceSettingChange(setting: string, value: any): Promise<any> {
        this.logger.log(['InferenceProcessor', 'info'], `Handle setting change for ${setting}: ${value}`);

        const result = {
            value,
            status: 'completed'
        };

        switch (setting) {
            case DeviceSetting.InferenceThreshold:
                this.confidenceThreshold = value;
                break;

            case DeviceSetting.DetectClass:
                this.detectClass = value;
                break;

            default:
                this.logger.log(['InferenceProcessor', 'info'], `Unknown setting change request ${setting}`);
                result.status = 'error';
        }

        return result;
    }

    private async publishInference(inference): Promise<void> {
        this.server.publish(Subscription.Inference, { inference });

        let detectClassCount = 0;
        const classes = inference.inferences.map(inferenceItem => {
            const className = _get(inferenceItem, 'display_name');

            if (className === this.detectClass) {
                detectClassCount++;
            }

            return className || 'Unkonwn';
        });

        await this.iotCentral.sendInferenceData(
            {
                [DeviceTelemetry.AllDetections]: inference.inferences.length,
                [DeviceTelemetry.Detections]: detectClassCount
            },
            {
                [DeviceEvent.Inference]: classes.join(', ')
            }
        );
    }
}
