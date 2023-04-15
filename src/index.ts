import { API } from 'homebridge';

import * as constants from "./constants";
import {DysonBP01} from "./accessory";

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
    api.registerAccessory(constants.ACCESSORY_NAME, DysonBP01);
};