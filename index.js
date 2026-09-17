// index.js
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
// 📌 접속 도메인을 erptest.shop으로 변경 (HTTPS 권장, 필요시 http로 수정)
let SERVER_URL = "http://erptest.shop:3000"; 

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: "#f5f7fa",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.setMenu(null);
    mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// 이하 통신 API 코드는 기존과 동일하게 유지됩니다.
ipcMain.handle("load-data", async () => {
    try {
        const response = await fetch(`${SERVER_URL}/api/data`);
        if (!response.ok) throw new Error("서버 응답 오류");
        return await response.json();
    } catch (error) {
        console.error("[Main] 데이터 불러오기 실패:", error);
        return null;
    }
});

ipcMain.handle("save-data", async (event, data) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error("서버 저장 오류");
        return await response.json();
    } catch (error) {
        console.error("[Main] 데이터 저장 실패:", error);
        return false;
    }
});

ipcMain.handle("login", async (event, credentials) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials)
        });
        return await response.json();
    } catch (error) {
        console.error("[Main] 로그인 통신 실패:", error);
        return { success: false, message: "서버에 연결할 수 없습니다." };
    }
});

ipcMain.handle("change-password", async (event, payload) => {
    try {
        const response = await fetch(`${SERVER_URL}/api/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[Main] 비밀번호 변경 통신 실패:", error);
        return { success: false, message: "서버에 연결할 수 없습니다." };
    }
});

ipcMain.handle("toggle-fullscreen", () => {
    if (!mainWindow) return false;
    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return nextState;
});

ipcMain.handle("log-activity", async (event, message) => {
    try {
        await fetch(`${SERVER_URL}/api/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
    } catch (error) {
        console.error("[Main] 로그 전송 실패:", error);
    }
});

// 기본 alert 창 포커스 버그 해결을 위한 동기식 시스템 알림창 띄우기
ipcMain.on("show-alert", (event, message) => {
    dialog.showMessageBoxSync({
        type: "info",
        title: "알림",
        message: String(message),
        buttons: ["확인"] // 확인 버튼 하나만 있는 창 생성
    });
    event.returnValue = true; // 창이 닫히면 렌더러로 리턴하여 다음 코드 실행
});