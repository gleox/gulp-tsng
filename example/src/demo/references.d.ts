declare module ng {
    export interface ILogCall {
        (...args: any[]): void;
    }

    export interface ILogService {
        log: ILogCall;
    }
    
    export interface ILogProvider {
        debugEnabled(enabled: boolean);
    }
}