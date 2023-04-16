import {
    AccessoryConfig,
    AccessoryPlugin,
    API,
    CharacteristicEventTypes,
    CharacteristicGetCallback,
    CharacteristicSetCallback,
    CharacteristicValue,
    HAP,
    Logging,
    Service
} from "homebridge";
import BroadLinkJS from "kiwicam-broadlinkjs-rm";
import nodePersist from "node-persist";
import ping from "ping";
import * as constants from "./constants";
import * as messages from "./messages";
import {v4 as uuidv4} from 'uuid';
import exp from "constants";

type DeviceState = {
    power: "OFF" | "ON",
    speed: number,
    isSwinging: boolean,
    airDirection: "STRAIGHT" | "WIDE"
}

const powerHapMapping = {
    "OFF": 0,
    "ON": 1,
};

type QueuedCommand = {
    irData: string,
    stateChange: Partial<DeviceState>,
    id?: string
};

export class DysonBP01 implements AccessoryPlugin {
    private readonly logging: Logging;
    private readonly hap: HAP;
    private readonly accessoryConfig: AccessoryConfig;
    private readonly broadLinkJS: BroadLinkJS;
    private device: any;
    private alive: boolean;

    private readonly localStorage: nodePersist.LocalStorage;

    /**
     * Services to provide accessory information, controls, and sensors
     * @private
     */
    private readonly services: {
        readonly accessoryInformation: Service,
        readonly fan: Service
    };

    /**
     * Cached device state (saved to local storage)
     * @private
     */
    private _deviceState: DeviceState;

    private devicePingFail: number;
    private commandQueue: Array<QueuedCommand>

    /**
     * Create accessory
     * @param logging Homebridge logging instance
     * @param accessoryConfig Homebridge accessory config
     * @param api Homebridge API
     */
    constructor(logging: Logging, accessoryConfig: AccessoryConfig, api: API) {
        this.logging = logging;
        this.hap = api.hap;
        this.accessoryConfig = accessoryConfig;
        this.broadLinkJS = new BroadLinkJS();
        this.device = undefined;
        this.alive = false;
        this.localStorage = nodePersist.create();

        this.services = {
            accessoryInformation: new this.hap.Service.AccessoryInformation(),
            fan: new this.hap.Service.Fanv2(this.accessoryConfig.name),
        };

        this._deviceState = {
            airDirection: "STRAIGHT",
            isSwinging: false,
            power: "ON",
            speed: 1,
        };

        this.commandQueue = [];

        this.devicePingFail = 0;

        // Update the cached device state from local storage
        this.localStorage.init({
            dir: api.user.persistPath(),
            forgiveParseErrors: true
        }).then(() => {
            this.updateCachedState().then(() => {
                this.configureBroadLink();
                this.initInterval();
            });
        });

        this.initServices();
    }

    /**
     * Explicit setter for `deviceState` that will update local storage
     * @param state
     */
    set deviceState(state: DeviceState) {
        this._deviceState = state;

        // In the background, update cached state
        this.localStorage.setItem(this.accessoryConfig.name, this._deviceState).then(() => {});
    }

    get deviceState() {
        return this._deviceState;
    }

    private emulateCompletedState(): DeviceState {
        const mockState = {...this.deviceState};
        this.commandQueue.forEach(x => this.processStateChange(x.stateChange, mockState));
        return mockState;
    }

    private initInterval(): void {
        // Interval to decrease cooldowns and failed pings
        setInterval(async () => {
            if (this.device) {
                if (this.alive) {
                    const command = this.commandQueue.shift();
                    if (command) {
                        await this.sendBroadLinkData(command.irData);
                        const currentState = this.deviceState;

                        // Process stateful changes
                        this.processStateChange(command.stateChange, currentState);

                        // Done to trigger custom setters/getters
                        this.deviceState = currentState;

                        this.logging.info(JSON.stringify(this.deviceState));
                    }
                    // if (this.canUpdateCurrentActive()) {
                    //     await this.updateCurrentActive();
                    // } else if (this.canUpdateCurrentRotationSpeed()) {
                    //     await this.updateCurrentRotationSpeed();
                    // } else if (this.canUpdateCurrentSwingMode()) {
                    //     await this.updateCurrentSwingMode();
                    // }
                }
            }
        }, 600);

        // Interval to ping device
        setInterval(async () => {
            if (this.device) {
                await this.pingDevice();
            } else {
                this.broadLinkJS.discover();
            }

            if (this.devicePingFail > 0) {
                this.devicePingFail--;

                if (this.devicePingFail == 0) {
                    this.logging.info(messages.DEVICE_PING_STABILIZED);
                }
            }
        }, 2000);
    }

    private processStateChange(partialState: Partial<DeviceState>, state: DeviceState) {
        for (let key in partialState) {
            // in the case of numbers, add
            if (typeof partialState[key] === "number") {
                state[key] += partialState[key];
            } else {
                state[key] = partialState[key];
            }
        }
    }

    /**
     * Push a command to the queue, with the ability to call a HAP command after the command has been processed
     * @param command
     * @param characteristicSetCallback
     * @private
     */
    private pushToQueue(command: QueuedCommand, characteristicSetCallback?: CharacteristicSetCallback) {
        if (!this.alive) {
            if (characteristicSetCallback) {
                characteristicSetCallback(new Error(`Device ping failed`));
            }

            return;
        }

        const commandWithId = {
            ...command,
            id: uuidv4(),
        };
        this.commandQueue.push(commandWithId);

        // If no callback is given, return without waiting
        if (!characteristicSetCallback) {
            return;
        }

        const interval = setInterval(() => {
            if (!this.commandQueue.find(x => x.id === commandWithId.id)) {
                clearInterval(interval);
                characteristicSetCallback()
            }
        }, 100);
    }

    private initServices(): void {
        this.services.accessoryInformation
            .updateCharacteristic(this.hap.Characteristic.Manufacturer, messages.INFO_MANUFACTURER)
            .updateCharacteristic(this.hap.Characteristic.Model, messages.INFO_MODEL)
            .updateCharacteristic(this.hap.Characteristic.SerialNumber,
                this.accessoryConfig.serialNumber.toUpperCase());

        this.services.fan.getCharacteristic(this.hap.Characteristic.Active)
            .on(CharacteristicEventTypes.GET, this.getCharacteristicProperty(() => powerHapMapping[this.deviceState.power]).bind(this))
            .on(CharacteristicEventTypes.SET, this.setPower.bind(this));

        this.services.fan.getCharacteristic(this.hap.Characteristic.CurrentFanState)
            .on(CharacteristicEventTypes.GET, this.getCharacteristicProperty(() => {
                if (this.deviceState.power === "ON") {
                    return this.hap.Characteristic.CurrentFanState.BLOWING_AIR;
                }

                return this.hap.Characteristic.CurrentFanState.IDLE
            }).bind(this));


        this.services.fan.getCharacteristic(this.hap.Characteristic.SwingMode)
            .on(CharacteristicEventTypes.GET, this.getCharacteristicProperty(() => this.deviceState.isSwinging).bind(this))
            .on(CharacteristicEventTypes.SET, this.setSwingMode.bind(this));

        this.services.fan.getCharacteristic(this.hap.Characteristic.RotationSpeed)
            .on(CharacteristicEventTypes.GET, this.getCharacteristicProperty(() => this.deviceState.speed).bind(this))
            .on(CharacteristicEventTypes.SET, this.setCurrentSpeed.bind(this));

        /*
        // Rotation Direction = Air Straight or Wide
        this.services.fan.getCharacteristic(this.hap.Characteristic.RotationDirection)
            .on(CharacteristicEventTypes.GET, this.getCharacteristicProperty(() => {
                if (this.deviceState.airDirection === "STRAIGHT") {
                    return this.hap.Characteristic.RotationDirection.CLOCKWISE;
                }

                return this.hap.Characteristic.RotationDirection.COUNTER_CLOCKWISE;
            }).bind(this))
            .on(CharacteristicEventTypes.SET, this.setRotationDirection.bind(this));
         */
    }

    public getServices(): Service[] {
        return [
            this.services.accessoryInformation,
            this.services.fan
        ];
    }

    private configureBroadLink(): void {
        this.broadLinkJS.on("deviceReady", device => {
            let macAddress: string = device.mac.toString("hex").replace(/(.{2})/g, "$1:").slice(0, -1).toUpperCase();
            this.logging.info(`Found device w/ MAC: ${macAddress}`);
            if (this.device == null && (this.accessoryConfig.macAddress == undefined ||
                this.accessoryConfig.macAddress.toUpperCase() == macAddress)) {
                this.device = device;

                this.logging.info(`Device set to be used w/ MAC: ${macAddress}`);
            }
        });
        this.logging.info(`Discovering device...`);
    }

    private async pingDevice(): Promise<void> {
        // Probe device status and update `this.alive` with data
        this.alive = await ping.promise.probe(this.device.host.address).then((pingResponse) => {
            return pingResponse.alive;
        });

        if (!this.alive) {
            if (this.devicePingFail == 0) {
                this.logging.info(messages.DEVICE_PING_FAILED);
            }

            this.devicePingFail = constants.SKIPS_DEVICE_PING_FAIL;
        } else if (this.devicePingFail > 0) {
            if (this.devicePingFail == constants.SKIPS_DEVICE_PING_FAIL - 1) {
                this.logging.info(messages.DEVICE_PING_STABILIZING);
            }
            this.alive = false;
        }
    }

    private sendBroadLinkData(data: string): void {
        this.device.sendData(Buffer.from(data, "hex"));
    }

    private async updateCachedState(): Promise<void> {
        this.deviceState =
            await this.localStorage.getItem(this.accessoryConfig.name) || this.deviceState;
        this.logging.info("Updated cached device state", JSON.stringify(this.deviceState));
    }

    /**
     * Returns a bindable function that returns a `characteristicGetCallback` for the value returned by `getter`
     * @param getter
     * @private
     */
    private getCharacteristicProperty<T extends CharacteristicValue>(getter: () => T): (characteristicGetCallback: CharacteristicGetCallback) => void {
        return (characteristicGetCallback: CharacteristicGetCallback) => {
            characteristicGetCallback(this.alive ? null : new Error(messages.DEVICE_PING_FAILED),
                getter());
        }
    }

    private async setPower(characteristicValue: CharacteristicValue,
                                  characteristicSetCallback: CharacteristicSetCallback): Promise<void> {
        const state = this.emulateCompletedState();
        const hapMapping = powerHapMapping[state.power];

        if (characteristicValue as number != hapMapping) {
            this.pushToQueue({
                irData: constants.IR_DATA_POWER,
                stateChange: {
                    power: characteristicValue === 0 ? "OFF" : "ON"
                }}, characteristicSetCallback);
        }
    }

    private async setSwingMode(characteristicValue: CharacteristicValue,
                                  characteristicSetCallback: CharacteristicSetCallback): Promise<void> {
        const state = this.emulateCompletedState();

        if (state.power === "OFF") {
            characteristicSetCallback(new Error("Fan state is off"));
            return;
        }

        if (Number(characteristicValue) != Number(state.isSwinging)) {
            this.pushToQueue({
                irData: constants.IR_DATA_SWING_MODE,
                stateChange: {
                    isSwinging: Number(characteristicValue) === 1
                }}, characteristicSetCallback);
        }
    }

    private async setCurrentSpeed(characteristicValue: CharacteristicValue,
                                  characteristicSetCallback: CharacteristicSetCallback): Promise<void> {
        const state = this.emulateCompletedState();
        const desiredSpeed = Math.ceil(Number(characteristicValue) / 10 + 0.01);

        if (desiredSpeed === state.speed) {
            return;
        }

        if (state.power === "OFF") {
            characteristicSetCallback(new Error("Fan state is off"));
            return;
        }

        if (state.speed < 0 || state.speed > 10) {
            characteristicSetCallback(new Error("Speed value not supported"));
            return;
        }

        const decrease = desiredSpeed < state.speed;
        const sign = decrease ? -1 : 1;
        const diff = Math.abs(desiredSpeed - state.speed);

        // For loop which has all needed steps EXCEPT for the last step
        // last step done outside of the for loop for proper callback support
        for(let i = 0; i < diff - 1; i++) {
            this.pushToQueue({
                irData: decrease ? constants.IR_DATA_SPEED_DECREASE : constants.IR_DATA_SPEED_INCREASE,
                stateChange: {
                    speed: sign
                }});
        }

        // notice the `characteristicSetCallback`
        this.pushToQueue({
            irData: decrease ? constants.IR_DATA_SPEED_DECREASE : constants.IR_DATA_SPEED_INCREASE,
            stateChange: {
                speed: sign
            }}, characteristicSetCallback);
    }
}
