package com.qualcomm.robotcore.eventloop.opmode;

import com.qualcomm.robotcore.hardware.HardwareMap;

public class LinearOpMode {
    public HardwareMap hardwareMap = new HardwareMap();
    public void runOpMode() {}

    public void waitForStart() {}
    public boolean opModeIsActive() { return true; }

    public Gamepad gamepad1 = new Gamepad();
    public Gamepad gamepad2 = new Gamepad();
    public Telemetry telemetry = new Telemetry();

    public void sleep(long milliseconds) {}

    public static class Gamepad {
        public float left_stick_y = 0;
        public float right_stick_x = 0;
    }

    public static class Telemetry {
        public void addData(String key, Object value) {}
        public void update() {}
    }
}
