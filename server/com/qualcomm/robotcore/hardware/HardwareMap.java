package com.qualcomm.robotcore.hardware;

public class HardwareMap {
    // Generic get method
    public <T> T get(Class<T> deviceClass, String name) {
        try {
            return deviceClass.getDeclaredConstructor().newInstance();
        } catch (Exception e) {
            return null;
        }
    }
}