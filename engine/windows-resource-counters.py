"""Read the Windows performance counters used by the build's CPU and memory policy."""
import ctypes
from ctypes import wintypes
import json
import math
import time


class CounterValue(ctypes.Union):
    _fields_ = [('number', ctypes.c_double), ('integer', ctypes.c_int64)]


class FormattedCounter(ctypes.Structure):
    _fields_ = [('status', wintypes.DWORD), ('value', CounterValue)]


def require_success(status, operation):
    if status:
        raise OSError(f'{operation}: PDH 0x{status & 0xffffffff:08x}')


def read_resources():
    pdh = ctypes.WinDLL('pdh', winmode=0x00000800)  # LOAD_LIBRARY_SEARCH_SYSTEM32

    def bind(name, *parameters):
        function = getattr(pdh, name)
        function.argtypes = parameters
        function.restype = wintypes.LONG
        return function

    handle_pointer = ctypes.POINTER(wintypes.HANDLE)
    open_query = bind('PdhOpenQueryW', wintypes.LPCWSTR, ctypes.c_size_t, handle_pointer)
    add_counter = bind('PdhAddEnglishCounterW', wintypes.HANDLE, wintypes.LPCWSTR, ctypes.c_size_t, handle_pointer)
    collect = bind('PdhCollectQueryData', wintypes.HANDLE)
    read_counter = bind('PdhGetFormattedCounterValue', wintypes.HANDLE, wintypes.DWORD,
                        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(FormattedCounter))
    close = bind('PdhCloseQuery', wintypes.HANDLE)
    paths = {
        'cpuPercent': r'\Processor(_Total)\% Processor Time',
        'availableMiB': r'\Memory\Available MBytes',
        'commitBytes': r'\Memory\Committed Bytes',
        'commitLimitBytes': r'\Memory\Commit Limit',
        'pagesInputPerSecond': r'\Memory\Pages Input/sec',
    }

    query = wintypes.HANDLE()
    require_success(open_query(None, 0, ctypes.byref(query)), 'open query')
    try:
        handles = {}
        for name, path in paths.items():
            handle = wintypes.HANDLE()
            require_success(add_counter(query, path, 0, ctypes.byref(handle)), name)
            handles[name] = handle

        # Rate counters need two observations over a nonzero sampling interval.
        require_success(collect(query), 'first sample')
        time.sleep(1)
        require_success(collect(query), 'second sample')

        values = {}
        for name, handle in handles.items():
            counter = FormattedCounter()
            require_success(read_counter(handle, 0x200, None, ctypes.byref(counter)), name)  # PDH_FMT_DOUBLE
            value = counter.value.number
            if counter.status not in (0, 1) or not math.isfinite(value) or value < 0:
                raise ValueError(f'Invalid {name} counter with status {counter.status}')
            values[name] = value

        values['availableBytes'] = int(values.pop('availableMiB')) * 1048576
        values['commitHeadroomBytes'] = values['commitLimitBytes'] - values['commitBytes']
        if not 0 <= values['cpuPercent'] <= 100 or values['commitHeadroomBytes'] < 0:
            raise ValueError('Invalid CPU or commit headroom')
        return values
    finally:
        require_success(close(query), 'close query')


if __name__ == '__main__':
    print(json.dumps(read_resources()))
