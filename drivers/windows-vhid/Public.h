#pragma once

#ifdef _KERNEL_MODE
#include <wdm.h>
#else
#include <winioctl.h>
#endif

#define SYNVHID_SYMBOLIC_LINK_NAME L"\\DosDevices\\Global\\2synvhid"

#define IOCTL_2SYNVHID_SUBMIT_KEYBOARD_REPORT \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_WRITE_DATA)

typedef struct _SYNVHID_KEYBOARD_REPORT {
    UCHAR Modifier;
    UCHAR Reserved;
    UCHAR Keys[6];
} SYNVHID_KEYBOARD_REPORT, *PSYNVHID_KEYBOARD_REPORT;
