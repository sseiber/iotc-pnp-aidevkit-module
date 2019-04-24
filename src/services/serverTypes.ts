export interface ICameraResult {
    status: boolean;
    title: string;
    message: string;
    body?: any;
}

export interface IFileUploadDetails {
    formFieldName: string;
    sourceFileName: string;
    destFileName: string;
    mimetype: string;
    destFileDirectory: string;
    destFilePath: string;
    size: number;
}

export const HealthState = {
    Good: 1,
    Warning: 0,
    Critical: 0
};
