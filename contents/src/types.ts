import { AppSettings, SecondaryAppConfig } from './config';

export type AppWindows = {
    [key in WindowType]: KWin.AbstractClient[];
};

export type WindowType = 'primary' | 'secondary' | 'other';

export interface WindowConfig {
    app: string;
    type: WindowType;
    settings: AppSettings;
}

export interface ClientWithMaybeSecondaryConfig {
    client: KWin.AbstractClient;
    secondaryConfig?: SecondaryAppConfig;
}
