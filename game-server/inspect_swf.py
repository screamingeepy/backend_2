import zlib
import struct

def inspect_swf(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    
    header = data[:8]
    magic = header[:3]
    version = header[3]
    file_length = struct.unpack('<I', header[4:8])[0]
    
    body = data[8:]
    if magic == b'CWS':
        body = zlib.decompress(body)
    
    print(f"Magic: {magic.decode('ascii')}, Version: {version}, Uncompressed Length: {len(body) + 8}")
    
    # Check for mannequin string or DoABC
    if b'mannequin' in body:
        print("Found 'mannequin' in SWF body!")
    if b'DoABC' in body or b'\x52\x00' in body or b'ShopPanel' in body:
        print("Found ActionScript DoABC / Symbol references!")

if __name__ == '__main__':
    inspect_swf(r'c:\jessi fairy\backend_2\web\swf\panel_content\shopPanel.swf')
