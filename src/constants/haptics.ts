export const HAPTICS_PROVIDER_STORE_KEY = "haptics.provider";
export const INTIFACE_WEBSOCKET_URL_STORE_KEY = "intiface.websocketUrl";
export const INTIFACE_DEVICE_INDEX_STORE_KEY = "intiface.deviceIndex";
export const INTIFACE_DEVICE_NAME_STORE_KEY = "intiface.deviceName";
export const INTIFACE_VIBRATION_SENSITIVITY_STORE_KEY = "intiface.vibrationSensitivity";
export const DEFAULT_INTIFACE_WEBSOCKET_URL = "ws://127.0.0.1:12345";
export const DEFAULT_INTIFACE_VIBRATION_SENSITIVITY = 1;
export const INTIFACE_VIBRATION_SENSITIVITY_MIN = 0.25;
export const INTIFACE_VIBRATION_SENSITIVITY_MAX = 3;
export const INTIFACE_VIBRATION_SENSITIVITY_STEP = 0.05;

export const TCODE_TRANSPORT_STORE_KEY = "tcode.transport";
export const TCODE_SERIAL_PATH_STORE_KEY = "tcode.serialPath";
export const TCODE_BAUD_RATE_STORE_KEY = "tcode.baudRate";
export const TCODE_WEBSOCKET_HOST_STORE_KEY = "tcode.websocketHost";
export const TCODE_WEBSOCKET_URL_STORE_KEY = "tcode.websocketUrl";
export const TCODE_PRECISION_STORE_KEY = "tcode.precision";
export const TCODE_AXIS_STORE_KEY = "tcode.axis";

export const DEFAULT_TCODE_TRANSPORT = "websocket";
export const DEFAULT_TCODE_BAUD_RATE = 115200;
export const DEFAULT_TCODE_WEBSOCKET_HOST = "192.168.4.1";
export const DEFAULT_TCODE_WEBSOCKET_PATH = "/ws";
export const DEFAULT_TCODE_WEBSOCKET_URL = `ws://${DEFAULT_TCODE_WEBSOCKET_HOST}${DEFAULT_TCODE_WEBSOCKET_PATH}`;
export const DEFAULT_TCODE_PRECISION = 4;
export const DEFAULT_TCODE_AXIS = "L0";
