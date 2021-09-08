var fs = require('fs');
var Service, Characteristic, DoorState; // set in the module.exports, from homebridge
var process = require('process');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;

  homebridge.registerAccessory("homebridge-garagedoor", "GarageDoor", GarageDoorAccessory);
}

function getVal(config, key, defaultVal) {
    var val = config[key];
    if (val == null) {
        return defaultVal;
    }
    return val;
}

function GarageDoorAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("GarageDoorAccessory version " + this.version);

  this.name = config["name"];
  this.doorSwitchPin = config["switchPin"];
  this.relayOn = getVal(config, "switchValue", 1);
  this.relayOff = 1-this.relayOn; //opposite of relayOn (O/1)
  this.doorSwitchPressTimeInMs = getVal(config, "switchPressTimeInMs", 1000);
  this.closedDoorSensorPin = getVal(config, "closedSensorPin", config["doorSensorPin"]);
  this.openDoorSensorPin = config["openSensorPin"];
  this.sensorPollInMs = getVal(config, "pollInMs", 4000);
  this.doorOpensInSeconds = config["opensInSeconds"];
  this.closedDoorSensorValue = getVal(config, "closedSensorValue", 1);
  this.openDoorSensorValue = getVal(config, "openSensorValue", 1);
  log("Switch Pin: " + this.doorSwitchPin);
  log("Switch Val: " + (this.relayOn == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  log("Switch Active Time in ms: " + this.doorSwitchPressTimeInMs);

  if (this.hasClosedSensor()) {
      log("Closed Sensor: Configured");
      log("    Closed Sensor Pin: " + this.closedDoorSensorPin);
      log("    Closed Sensor Val: " + (this.closedDoorSensorValue == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  } else {
      log("Closed Sensor: Not Configured");
  }

  if(this.hasOpenSensor()) {
      log("Open Sensor: Configured");
      log("    Open Sensor Pin: " + this.openDoorSensorPin);
      log("    Open Sensor Val: " + (this.openDoorSensorValue == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  } else {
      log("Open Sensor: Not Configured");
  }

  if (!this.hasClosedSensor() && !this.hasOpenSensor()) {
      this.wasClosed = true; //Set a valid initial state
      log("NOTE: Neither Open nor Closed sensor is configured. Will be unable to determine what state the " + this.name + " is in, and will rely on last known state.");
  }
  log("Sensor Poll in ms: " + this.sensorPollInMs);
  log("Opens in seconds: " + this.doorOpensInSeconds);
  this.initService();
}

GarageDoorAccessory.prototype = {

  determineCurrentDoorState: function() {
    switch (this.isState()) {
      case 0:
        return DoorState.OPEN;
      case 1:
        return DoorState.CLOSED;
      case 2:                   // operating state, returns open because door is in motion and thus not closed
        return DoorState.OPEN;  // if door gets stuck in this state then it is considered open for security
    }
  },
  
  doorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSED";
	  case DoorState.OPENING :
        return "OPENING";
	  case DoorState.CLOSING :
        return "CLOSING";
      default:
        return "UNKNOWN";
    }
  },

  monitorDoorState: function() {
     var isState = this.isState();
     if (isState != this.wasState) {
       if (!this.operating) {
	       if (isState == 2 && this.wasState == 0) {    // was open, is now moving
		        this.click = true;
		        this.log("Click = true");
		        this.targetDoorState.setValue(DoorState.CLOSED);
		        this.currentDoorState.setValue(DoorState.CLOSING);
		        this.targetState = DoorState.CLOSED;
		        this.wasState = isState;
		        this.log("State changed to CLOSING, Remote");

         } else if (isState == 2 && this.wasState == 1) {   // was closed, is now moving
		        this.click = true;
		        this.log("Click = true");
		        this.targetDoorState.setValue(DoorState.OPEN);
		        this.currentDoorState.setValue(DoorState.OPENING);
		        this.targetState = DoorState.OPEN;
		        this.wasState = isState;
		        this.log("State changed to OPENING, Remote");

         } else {   // was moving, is now closed/open
            var state = this.determineCurrentDoorState();
		        this.currentDoorState.setValue(state);
		        this.log("State changed to " + this.doorStateToString(state) + ", Remote");
		        this.targetState = state;
		        this.wasState = isState;
		        if (isState != 2) {
			        this.click = false;
			        this.log("Click = false");
		        }
         }
       }
     }
     setTimeout(this.monitorDoorState.bind(this), this.sensorPollInMs);
  },

  hasOpenSensor : function() {
    return this.openDoorSensorPin != null;
  },

  hasClosedSensor : function() {
    return this.closedDoorSensorPin != null;
  },

  initService: function() {
    this.garageDoorOpener = new Service.GarageDoorOpener(this.name,this.name);
    this.currentDoorState = this.garageDoorOpener.getCharacteristic(DoorState);
    this.currentDoorState.on('get', this.getState.bind(this));
    this.targetDoorState = this.garageDoorOpener.getCharacteristic(Characteristic.TargetDoorState);
    this.targetDoorState.on('set', this.setState.bind(this));
    this.targetDoorState.on('get', this.getTargetState.bind(this));
    
    var isState = this.isState();
    this.wasState = isState;
    this.operating = false;
    this.click = false;
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Jacob Kelly")
      .setCharacteristic(Characteristic.Model, "Garage Door")
      .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");
  
    if (this.hasOpenSensor() || this.hasClosedSensor()) {
        this.log("We have a sensor, monitoring state enabled.");
        setTimeout(this.monitorDoorState.bind(this), this.sensorPollInMs);
    }

    var state = this.determineCurrentDoorState();
    this.log("Initial State: " + this.doorStateToString(state));
    this.currentDoorState.setValue(state);
    this.targetDoorState.setValue(state);

  },

  getTargetState: function(callback) {
    callback(null, this.targetState);
  },

  readPin: function(pin) {
    return parseInt(fs.readFileSync("/sys/class/gpio/gpio"+pin+"/value", "utf8").trim());
  },

  writePin: function(pin,val) {
    fs.writeFileSync("/sys/class/gpio/gpio"+pin+"/value", val.toString());
  },

  isState: function() {
    if (this.readPin(this.openDoorSensorPin) == this.openDoorSensorValue) {   // is fully open
      return 0;
    } else if (this.readPin(this.closedDoorSensorPin) == this.closedDoorSensorValue) {    // is fully closed
      return 1;
    } else {    // is in motion or stuck inbetween states
      return 2;
    }
  },

  switchOn: function() {
    this.writePin(this.doorSwitchPin, this.relayOn);
    this.log("Turning on " + this.name + " Relay, pin " + this.doorSwitchPin + " = " + this.relayOn);
    setTimeout(this.switchOff.bind(this), this.doorSwitchPressTimeInMs);
  },

  switchOff: function() {
    this.writePin(this.doorSwitchPin, this.relayOff);
    this.log("Turning off " + this.name + " Relay, pin " + this.doorSwitchPin + " = " + this.relayOff);
  },

  setFinalDoorState: function() {
    var isState = this.isState();
    var state = this.determineCurrentDoorState();
    if ((this.targetState == DoorState.CLOSED && isState != 1) || (this.targetState == DoorState.OPEN && isState != 0)) {
      this.log("Was trying to " + this.doorStateToString(this.targetState) + " " + this.name + " , but it is still " + this.doorStateToString(state));
    } else {
      this.log("Set current state to " + this.doorStateToString(this.targetState) + ", App");
      if (this.TargetState == DoorState.CLOSED) {
        this.wasState = 1;
      } else {
        this.wasState = 0;
      }
      this.currentDoorState.setValue(this.targetState);
    }
    this.operating = false;
    this.log("Operating = false");
  },

  setState: function(state, callback) {
    this.log("Setting state to " + state + ", App");
    this.targetState = state;
    var isState = this.isState();
    if (!this.click && ((state == DoorState.OPEN && isState == 1) || (state == DoorState.CLOSED && isState != 1))) {
        this.log("Triggering Relay");
        this.operating = true;
	this.log("Operating = true");
        if (state == DoorState.OPEN) {
            	this.currentDoorState.setValue(DoorState.OPENING);
        } else {
            this.currentDoorState.setValue(DoorState.CLOSING);
	}
	setTimeout(this.setFinalDoorState.bind(this), this.doorOpensInSeconds * 1000);
	this.switchOn();
	}

    callback();
    return true;
  },

  getState: function(callback) {
    var isState = this.isState();
    var state = this.determineCurrentDoorState();
    this.log(this.name + " " + this.doorStateToString(state)); 
    callback(null, state);
  },

  getServices: function() {
    return [this.infoService, this.garageDoorOpener];
  }
};
