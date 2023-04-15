import { API } from 'homebridge';

import * as constants from "./constants";
import {DysonBP01} from "./accessory";

export = (api: API) => {
    api.registerAccessory(constants.ACCESSORY_NAME, DysonBP01);
};