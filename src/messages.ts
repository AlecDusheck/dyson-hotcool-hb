/**
 * Placeholder string used by messages to insert values
 */
export const PLACEHOLDER: string = "$VAL$";

/**
 * Information service manufacturer field
 */
export const INFO_MANUFACTURER: string  = "Dyson";

/**
 * Information service model field
 */
export const INFO_MODEL: string = "BP01";

/**
 * Information service serial number field
 */
export const INFO_SERIAL_NUMBER: string = "Printed under machine";

/**
 * Identify message when the BroadLink RM is not connected
 */
export const IDENTIFY_NOT_CONNECTED: string = "Identified, BroadLink RM not connected";

/**
 * Identify message when the BroadLink RM is connected
 */
export const IDENTIFY_CONNECTED: string = "Identified, BroadLink RM connected at " + PLACEHOLDER;

/**
 * Message shown when the plugin is initially searching for the BroadLink RM
 */
export const DEVICE_SEARCHING: string = "Searching for BroadLink RM...";

/**
 * Message shown when the BroadLink RM is discovered
 */
export const DEVICE_DISCOVERED: string = "BroadLink RM discovered at " + PLACEHOLDER;

/**
 * Message shown when the plugin is attempting to reconnect to the BroadLink RM
 */
export const DEVICE_RECONNECTING: string = "Reconnecting to BroadLink RM...";

/**
 * Message shown when the BroadLink RM is reconnected
 */
export const DEVICE_RECONNECTED: string = "BroadLink RM reconnected";

/**
 * Message shown when loading the previous active state
 */
export const ACTIVE_INIT: string = "Active is " + PLACEHOLDER;

/**
 * Message shown when changing the active state
 */
export const ACTIVE_SET: string = "Active set to " + PLACEHOLDER;

/**
 * Message shown when loading the previous rotation speed
 */
export const ROTATION_SPEED_INIT: string = "Rotation speed is " + PLACEHOLDER + "%";

/**
 * Message shown when setting a new rotation speed
 */
export const ROTATION_SPEED_SET: string = "Rotation speed set to " + PLACEHOLDER + "%";

/**
 * Message shown when changing the swing mode
 */
export const SWING_MODE_INIT: string = "Swing mode is " + PLACEHOLDER;

/**
 * Message shown when changing the swing mode
 */
export const SWING_MODE_SET: string = "Swing mode set to " + PLACEHOLDER;