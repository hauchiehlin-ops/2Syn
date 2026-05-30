#!/usr/bin/env python3
import json, os

locales_dir = "/Users/barretlin/GitProjects/2syn/desktop/public/locales"
translations = {
    "en": {
        "device_book_title": "Saved Devices",
        "device_book_empty": "No saved devices yet. Connect to a device to save it.",
        "device_book_add": "Save Current",
        "device_book_connect": "Connect",
        "device_book_delete": "Remove",
        "device_book_name_placeholder": "Device nickname",
        "device_book_last_connected": "Last connected:",
        "device_book_never": "Never"
    },
    "zh-TW": {
        "device_book_title": "裝置地址簿",
        "device_book_empty": "尚未儲存任何裝置。連線後即可儲存。",
        "device_book_add": "儲存目前連線",
        "device_book_connect": "連線",
        "device_book_delete": "移除",
        "device_book_name_placeholder": "裝置昵稱",
        "device_book_last_connected": "最後連線：",
        "device_book_never": "尚未連線"
    },
    "zh-CN": {
        "device_book_title": "设备地址簿",
        "device_book_empty": "尚未保存任何设备。连接后即可保存。",
        "device_book_add": "保存当前连接",
        "device_book_connect": "连接",
        "device_book_delete": "移除",
        "device_book_name_placeholder": "设备昵称",
        "device_book_last_connected": "上次连接：",
        "device_book_never": "未连接"
    },
    "ja": {
        "device_book_title": "デバイスリスト",
        "device_book_empty": "保存されたデバイスはありません。接続すると保存されます。",
        "device_book_add": "現在の接続を保存",
        "device_book_connect": "接続",
        "device_book_delete": "削除",
        "device_book_name_placeholder": "デバイス名",
        "device_book_last_connected": "最終接続：",
        "device_book_never": "未接続"
    },
    "ko": {
        "device_book_title": "저장된 장치",
        "device_book_empty": "저장된 장치가 없습니다. 연결하면 저장됩니다.",
        "device_book_add": "현재 저장",
        "device_book_connect": "연결",
        "device_book_delete": "제거",
        "device_book_name_placeholder": "장치 별칭",
        "device_book_last_connected": "마지막 연결:",
        "device_book_never": "연결된 적 없음"
    },
    "de": {
        "device_book_title": "Gespeicherte Geräte",
        "device_book_empty": "Keine gespeicherten Geräte. Verbinden Sie sich, um zu speichern.",
        "device_book_add": "Aktuelle speichern",
        "device_book_connect": "Verbinden",
        "device_book_delete": "Entfernen",
        "device_book_name_placeholder": "Gerätename",
        "device_book_last_connected": "Zuletzt verbunden:",
        "device_book_never": "Nie"
    },
    "es": {
        "device_book_title": "Dispositivos guardados",
        "device_book_empty": "No hay dispositivos guardados. Conectése para guardar.",
        "device_book_add": "Guardar actual",
        "device_book_connect": "Conectar",
        "device_book_delete": "Eliminar",
        "device_book_name_placeholder": "Nombre del dispositivo",
        "device_book_last_connected": "Última conexión:",
        "device_book_never": "Nunca"
    },
    "id": {
        "device_book_title": "Perangkat Tersimpan",
        "device_book_empty": "Belum ada perangkat tersimpan. Hubungkan untuk menyimpan.",
        "device_book_add": "Simpan Saat Ini",
        "device_book_connect": "Hubungkan",
        "device_book_delete": "Hapus",
        "device_book_name_placeholder": "Nama perangkat",
        "device_book_last_connected": "Terakhir terhubung:",
        "device_book_never": "Belum pernah"
    },
    "ms": {
        "device_book_title": "Peranti Tersimpan",
        "device_book_empty": "Tiada peranti tersimpan. Sambung untuk menyimpan.",
        "device_book_add": "Simpan Semasa",
        "device_book_connect": "Sambung",
        "device_book_delete": "Buang",
        "device_book_name_placeholder": "Nama peranti",
        "device_book_last_connected": "Sambungan terakhir:",
        "device_book_never": "Tidak pernah"
    },
    "ru": {
        "device_book_title": "Сохранённые устройства",
        "device_book_empty": "Нет сохранённых устройств. Подключитесь, чтобы сохранить.",
        "device_book_add": "Сохранить текущее",
        "device_book_connect": "Подключиться",
        "device_book_delete": "Удалить",
        "device_book_name_placeholder": "Название устройства",
        "device_book_last_connected": "Последнее подключение:",
        "device_book_never": "Никогда"
    },
    "th": {
        "device_book_title": "อุปกรณ์ที่บันทึก",
        "device_book_empty": "ยังไม่มีอุปกรณ์ที่บันทึก เชื่อมต่อเพื่อบันทึก",
        "device_book_add": "บันทึกปัจจุบัน",
        "device_book_connect": "เชื่อมต่อ",
        "device_book_delete": "ลบออก",
        "device_book_name_placeholder": "ชื่ออุปกรณ์",
        "device_book_last_connected": "เชื่อมต่อล่าสุด:",
        "device_book_never": "ไม่เคย"
    }
}

for lang, keys in translations.items():
    filepath = os.path.join(locales_dir, f"{lang}.json")
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    data.update(keys)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Updated {lang}.json")
print("Done")
