// tslint:disable:no-bitwise
import { BitStream } from "./BitStream";
import { shiftJISTable } from "./shiftJISTable";
export var Mode;
(function (Mode) {
    Mode["Numeric"] = "numeric";
    Mode["Alphanumeric"] = "alphanumeric";
    Mode["Byte"] = "byte";
    Mode["Kanji"] = "kanji";
    Mode["ECI"] = "eci";
})(Mode || (Mode = {}));
var ModeByte;
(function (ModeByte) {
    ModeByte[ModeByte["Terminator"] = 0] = "Terminator";
    ModeByte[ModeByte["Numeric"] = 1] = "Numeric";
    ModeByte[ModeByte["Alphanumeric"] = 2] = "Alphanumeric";
    ModeByte[ModeByte["Byte"] = 4] = "Byte";
    ModeByte[ModeByte["Kanji"] = 8] = "Kanji";
    ModeByte[ModeByte["ECI"] = 7] = "ECI";
    // StructuredAppend = 0x3,
    // FNC1FirstPosition = 0x5,
    // FNC1SecondPosition = 0x9,
})(ModeByte || (ModeByte = {}));
function decodeNumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [10, 12, 14][size];
    let length = stream.readBits(characterCountSize);
    // Read digits in groups of 3
    while (length >= 3) {
        const num = stream.readBits(10);
        if (num >= 1000) {
            throw new Error("Invalid numeric value above 999");
        }
        const a = Math.floor(num / 100);
        const b = Math.floor(num / 10) % 10;
        const c = num % 10;
        bytes.push(48 + a, 48 + b, 48 + c);
        text += a.toString() + b.toString() + c.toString();
        length -= 3;
    }
    // If the number of digits aren't a multiple of 3, the remaining digits are special cased.
    if (length === 2) {
        const num = stream.readBits(7);
        if (num >= 100) {
            throw new Error("Invalid numeric value above 99");
        }
        const a = Math.floor(num / 10);
        const b = num % 10;
        bytes.push(48 + a, 48 + b);
        text += a.toString() + b.toString();
    }
    else if (length === 1) {
        const num = stream.readBits(4);
        if (num >= 10) {
            throw new Error("Invalid numeric value above 9");
        }
        bytes.push(48 + num);
        text += num.toString();
    }
    return { bytes, text };
}
const AlphanumericCharacterCodes = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8",
    "9", "A", "B", "C", "D", "E", "F", "G", "H",
    "I", "J", "K", "L", "M", "N", "O", "P", "Q",
    "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    " ", "$", "%", "*", "+", "-", ".", "/", ":",
];
function decodeAlphanumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [9, 11, 13][size];
    let length = stream.readBits(characterCountSize);
    while (length >= 2) {
        const v = stream.readBits(11);
        const a = Math.floor(v / 45);
        const b = v % 45;
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0), AlphanumericCharacterCodes[b].charCodeAt(0));
        text += AlphanumericCharacterCodes[a] + AlphanumericCharacterCodes[b];
        length -= 2;
    }
    if (length === 1) {
        const a = stream.readBits(6);
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0));
        text += AlphanumericCharacterCodes[a];
    }
    return { bytes, text };
}
function decodeByte(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [8, 16, 16][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const b = stream.readBits(8);
        bytes.push(b);
    }
    try {
        text += decodeURIComponent(bytes.map(b => `%${("0" + b.toString(16)).substr(-2)}`).join(""));
    }
    catch {
        // failed to decode
    }
    return { bytes, text };
}
function decodeKanji(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [8, 10, 12][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const k = stream.readBits(13);
        let c = (Math.floor(k / 0xC0) << 8) | (k % 0xC0);
        if (c < 0x1F00) {
            c += 0x8140;
        }
        else {
            c += 0xC140;
        }
        bytes.push(c >> 8, c & 0xFF);
        text += String.fromCharCode(shiftJISTable[c]);
    }
    return { bytes, text };
}
export function decode(data, version) {
    const stream = new BitStream(data);
    // There are 3 'sizes' based on the version. 1-9 is small (0), 10-26 is medium (1) and 27-40 is large (2).
    const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    const result = {
        text: "",
        bytes: [],
        chunks: [],
        version,
    };
    while (stream.available() >= 4) {
        const mode = stream.readBits(4);
        if (mode === ModeByte.Terminator) {
            return result;
        }
        else if (mode === ModeByte.ECI) {
            if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(7),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(14),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(21),
                });
            }
            else {
                // ECI data seems corrupted
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: -1,
                });
            }
        }
        else if (mode === ModeByte.Numeric) {
            const numericResult = decodeNumeric(stream, size);
            result.text += numericResult.text;
            result.bytes.push(...numericResult.bytes);
            result.chunks.push({
                type: Mode.Numeric,
                text: numericResult.text,
            });
        }
        else if (mode === ModeByte.Alphanumeric) {
            const alphanumericResult = decodeAlphanumeric(stream, size);
            result.text += alphanumericResult.text;
            result.bytes.push(...alphanumericResult.bytes);
            result.chunks.push({
                type: Mode.Alphanumeric,
                text: alphanumericResult.text,
            });
        }
        else if (mode === ModeByte.Byte) {
            const byteResult = decodeByte(stream, size);
            result.text += byteResult.text;
            result.bytes.push(...byteResult.bytes);
            result.chunks.push({
                type: Mode.Byte,
                bytes: byteResult.bytes,
                text: byteResult.text,
            });
        }
        else if (mode === ModeByte.Kanji) {
            const kanjiResult = decodeKanji(stream, size);
            result.text += kanjiResult.text;
            result.bytes.push(...kanjiResult.bytes);
            result.chunks.push({
                type: Mode.Kanji,
                bytes: kanjiResult.bytes,
                text: kanjiResult.text,
            });
        }
    }
    // If there is no data left, or the remaining bits are all 0, then that counts as a termination marker
    if (stream.available() === 0 || stream.readBits(stream.available()) === 0) {
        return result;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wcm9qZWN0cy9uZ3gtc2Nhbm5lci1xcmNvZGUvc3JjL2xpYi9xcmNvZGUvZGVjb2Rlci9kZWNvZGVEYXRhL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLDRCQUE0QjtBQUM1QixPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBQ3hDLE9BQU8sRUFBRSxhQUFhLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQTBCaEQsTUFBTSxDQUFOLElBQVksSUFNWDtBQU5ELFdBQVksSUFBSTtJQUNkLDJCQUFtQixDQUFBO0lBQ25CLHFDQUE2QixDQUFBO0lBQzdCLHFCQUFhLENBQUE7SUFDYix1QkFBZSxDQUFBO0lBQ2YsbUJBQVcsQ0FBQTtBQUNiLENBQUMsRUFOVyxJQUFJLEtBQUosSUFBSSxRQU1mO0FBRUQsSUFBSyxRQVVKO0FBVkQsV0FBSyxRQUFRO0lBQ1gsbURBQWdCLENBQUE7SUFDaEIsNkNBQWEsQ0FBQTtJQUNiLHVEQUFrQixDQUFBO0lBQ2xCLHVDQUFVLENBQUE7SUFDVix5Q0FBVyxDQUFBO0lBQ1gscUNBQVMsQ0FBQTtJQUNULDBCQUEwQjtJQUMxQiwyQkFBMkI7SUFDM0IsNEJBQTRCO0FBQzlCLENBQUMsRUFWSSxRQUFRLEtBQVIsUUFBUSxRQVVaO0FBRUQsU0FBUyxhQUFhLENBQUMsTUFBaUIsRUFBRSxJQUFZO0lBQ3BELE1BQU0sS0FBSyxHQUFhLEVBQUUsQ0FBQztJQUMzQixJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7SUFFZCxNQUFNLGtCQUFrQixHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5QyxJQUFJLE1BQU0sR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLENBQUM7SUFDakQsNkJBQTZCO0lBQzdCLE9BQU8sTUFBTSxJ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QUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDO2dCQUNqQixJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7Z0JBQ2YsS0FBSyxFQUFFLFVBQVUsQ0FBQyxLQUFLO2dCQUN2QixJQUFJLEVBQUUsVUFBVSxDQUFDLElBQUk7YUFDdEIsQ0FBQyxDQUFDO1NBQ0o7YUFBTSxJQUFJLElBQUksS0FBSyxRQUFRLENBQUMsS0FBSyxFQUFFO1lBQ2xDLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDOUMsTUFBTSxDQUFDLElBQUksSUFBSSxXQUFXLENBQUMsSUFBSSxDQUFDO1lBQ2hDLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDO2dCQUNqQixJQUFJLEVBQUUsSUFBSSxDQUFDLEtBQUs7Z0JBQ2hCLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSztnQkFDeEIsSUFBSSxFQUFFLFdBQVcsQ0FBQyxJQUFJO2FBQ3ZCLENBQUMsQ0FBQztTQUNKO0tBQ0Y7SUFFRCxzR0FBc0c7SUFDdEcsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFO1FBQ3pFLE9BQU8sTUFBTSxDQUFDO0tBQ2Y7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gdHNsaW50OmRpc2FibGU6bm8tYml0d2lzZVxuaW1wb3J0IHsgQml0U3RyZWFtIH0gZnJvbSBcIi4vQml0U3RyZWFtXCI7XG5pbXBvcnQgeyBzaGlmdEpJU1RhYmxlIH0gZnJvbSBcIi4vc2hpZnRKSVNUYWJsZVwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIENodW5rIHtcbiAgdHlwZTogTW9kZTtcbiAgdGV4dDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJ5dGVDaHVuayB7XG4gIHR5cGU6IE1vZGUuQnl0ZSB8IE1vZGUuS2Fuamk7XG4gIGJ5dGVzOiBudW1iZXJbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFQ0lDaHVuayB7XG4gIHR5cGU6IE1vZGUuRUNJO1xuICBhc3NpZ25tZW50TnVtYmVyOiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIENodW5rcyA9IEFycmF5PENodW5rIHwgQnl0ZUNodW5rIHwgRUNJQ2h1bms+O1xuXG5leHBvcnQgaW50ZXJmYWNlIERlY29kZWRRUiB7XG4gIHRleHQ6IHN0cmluZztcbiAgYnl0ZXM6IG51bWJlcltdO1xuICBjaHVua3M6IENodW5rcztcbiAgdmVyc2lvbjogbnVtYmVyO1xufVxuXG5leHBvcnQgZW51bSBNb2RlIHtcbiAgTnVtZXJpYyA9IFwibnVtZXJpY1wiLFxuICBBbHBoYW51bWVyaWMgPSBcImFscGhhbnVtZXJpY1wiLFxuICBCeXRlID0gXCJieXRlXCIsXG4gIEthbmppID0gXCJrYW5qaVwiLFxuICBFQ0kgPSBcImVjaVwiLFxufVxuXG5lbnVtIE1vZGVCeXRlIHtcbiAgVGVybWluYXRvciA9IDB4MCxcbiAgTnVtZXJpYyA9IDB4MSxcbiAgQWxwaGFudW1lcmljID0gMHgyLFxuICBCeXRlID0gMHg0LFxuICBLYW5qaSA9IDB4OCxcbiAgRUNJID0gMHg3LFxuICAvLyBTdHJ1Y3R1cmVkQXBwZW5kID0gMHgzLFxuICAvLyBGTkMxRmlyc3RQb3NpdGlvbiA9IDB4NSxcbiAgLy8gRk5DMVNlY29uZFBvc2l0aW9uID0gMHg5LFxufVxuXG5mdW5jdGlvbiBkZWNvZGVOdW1lcmljKHN0cmVhbTogQml0U3RyZWFtLCBzaXplOiBudW1iZXIpIHtcbiAgY29uc3QgYnl0ZXM6IG51bWJlcltdID0gW107XG4gIGxldCB0ZXh0ID0gXCJcIjtcblxuICBjb25zdCBjaGFyYWN0ZXJDb3VudFNpemUgPSBbMTAsIDEyLCAxNF1bc2l6ZV07XG4gIGxldCBsZW5ndGggPSBzdHJlYW0ucmVhZEJpdHMoY2hhcmFjdGVyQ291bnRTaXplKTtcbiAgLy8gUmVhZCBkaWdpdHMgaW4gZ3JvdXBzIG9mIDNcbiAgd2hpbGUgKGxlbmd0aCA+PSAzKSB7XG4gICAgY29uc3QgbnVtID0gc3RyZWFtLnJlYWRCaXRzKDEwKTtcbiAgICBpZiAobnVtID49IDEwMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgbnVtZXJpYyB2YWx1ZSBhYm92ZSA5OTlcIik7XG4gICAgfVxuXG4gICAgY29uc3QgYSA9IE1hdGguZmxvb3IobnVtIC8gMTAwKTtcbiAgICBjb25zdCBiID0gTWF0aC5mbG9vcihudW0gLyAxMCkgJSAxMDtcbiAgICBjb25zdCBjID0gbnVtICUgMTA7XG5cbiAgICBieXRlcy5wdXNoKDQ4ICsgYSwgNDggKyBiLCA0OCArIGMpO1xuICAgIHRleHQgKz0gYS50b1N0cmluZygpICsgYi50b1N0cmluZygpICsgYy50b1N0cmluZygpO1xuICAgIGxlbmd0aCAtPSAzO1xuICB9XG5cbiAgLy8gSWYgdGhlIG51bWJlciBvZiBkaWdpdHMgYXJlbid0IGEgbXVsdGlwbGUgb2YgMywgdGhlIHJlbWFpbmluZyBkaWdpdHMgYXJlIHNwZWNpYWwgY2FzZWQuXG4gIGlmIChsZW5ndGggPT09IDIpIHtcbiAgICBjb25zdCBudW0gPSBzdHJlYW0ucmVhZEJpdHMoNyk7XG4gICAgaWYgKG51bSA+PSAxMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgbnVtZXJpYyB2YWx1ZSBhYm92ZSA5OVwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBhID0gTWF0aC5mbG9vcihudW0gLyAxMCk7XG4gICAgY29uc3QgYiA9IG51bSAlIDEwO1xuXG4gICAgYnl0ZXMucHVzaCg0OCArIGEsIDQ4ICsgYik7XG4gICAgdGV4dCArPSBhLnRvU3RyaW5nKCkgKyBiLnRvU3RyaW5nKCk7XG4gIH0gZWxzZSBpZiAobGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbnVtID0gc3RyZWFtLnJlYWRCaXRzKDQpO1xuICAgIGlmIChudW0gPj0gMTApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgbnVtZXJpYyB2YWx1ZSBhYm92ZSA5XCIpO1xuICAgIH1cblxuICAgIGJ5dGVzLnB1c2goNDggKyBudW0pO1xuICAgIHRleHQgKz0gbnVtLnRvU3RyaW5nKCk7XG4gIH1cblxuICByZXR1cm4geyBieXRlcywgdGV4dCB9O1xufVxuXG5jb25zdCBBbHBoYW51bWVyaWNDaGFyYWN0ZXJDb2RlcyA9IFtcbiAgXCIwXCIsIFwiMVwiLCBcIjJcIiwgXCIzXCIsIFwiNFwiLCBcIjVcIiwgXCI2XCIsIFwiN1wiLCBcIjhcIixcbiAgXCI5XCIsIFwiQVwiLCBcIkJcIiwgXCJDXCIsIFwiRFwiLCBcIkVcIiwgXCJGXCIsIFwiR1wiLCBcIkhcIixcbiAgXCJJXCIsIFwiSlwiLCBcIktcIiwgXCJMXCIsIFwiTVwiLCBcIk5cIiwgXCJPXCIsIFwiUFwiLCBcIlFcIixcbiAgXCJSXCIsIFwiU1wiLCBcIlRcIiwgXCJVXCIsIFwiVlwiLCBcIldcIiwgXCJYXCIsIFwiWVwiLCBcIlpcIixcbiAgXCIgXCIsIFwiJFwiLCBcIiVcIiwgXCIqXCIsIFwiK1wiLCBcIi1cIiwgXCIuXCIsIFwiL1wiLCBcIjpcIixcbl07XG5cbmZ1bmN0aW9uIGRlY29kZUFscGhhbnVtZXJpYyhzdHJlYW06IEJpdFN0cmVhbSwgc2l6ZTogbnVtYmVyKSB7XG4gIGNvbnN0IGJ5dGVzOiBudW1iZXJbXSA9IFtdO1xuICBsZXQgdGV4dCA9IFwiXCI7XG5cbiAgY29uc3QgY2hhcmFjdGVyQ291bnRTaXplID0gWzksIDExLCAxM11bc2l6ZV07XG4gIGxldCBsZW5ndGggPSBzdHJlYW0ucmVhZEJpdHMoY2hhcmFjdGVyQ291bnRTaXplKTtcbiAgd2hpbGUgKGxlbmd0aCA+PSAyKSB7XG4gICAgY29uc3QgdiA9IHN0cmVhbS5yZWFkQml0cygxMSk7XG5cbiAgICBjb25zdCBhID0gTWF0aC5mbG9vcih2IC8gNDUpO1xuICAgIGNvbnN0IGIgPSB2ICUgNDU7XG5cbiAgICBieXRlcy5wdXNoKEFscGhhbnVtZXJpY0NoYXJhY3RlckNvZGVzW2FdLmNoYXJDb2RlQXQoMCksIEFscGhhbnVtZXJpY0NoYXJhY3RlckNvZGVzW2JdLmNoYXJDb2RlQXQoMCkpO1xuICAgIHRleHQgKz0gQWxwaGFudW1lcmljQ2hhcmFjdGVyQ29kZXNbYV0gKyBBbHBoYW51bWVyaWNDaGFyYWN0ZXJDb2Rlc1tiXTtcbiAgICBsZW5ndGggLT0gMjtcbiAgfVxuXG4gIGlmIChsZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBhID0gc3RyZWFtLnJlYWRCaXRzKDYpO1xuICAgIGJ5dGVzLnB1c2goQWxwaGFudW1lcmljQ2hhcmFjdGVyQ29kZXNbYV0uY2hhckNvZGVBdCgwKSk7XG4gICAgdGV4dCArPSBBbHBoYW51bWVyaWNDaGFyYWN0ZXJDb2Rlc1thXTtcbiAgfVxuXG4gIHJldHVybiB7IGJ5dGVzLCB0ZXh0IH07XG59XG5cbmZ1bmN0aW9uIGRlY29kZUJ5dGUoc3RyZWFtOiBCaXRTdHJlYW0sIHNpemU6IG51bWJlcikge1xuICBjb25zdCBieXRlczogbnVtYmVyW10gPSBbXTtcbiAgbGV0IHRleHQgPSBcIlwiO1xuXG4gIGNvbnN0IGNoYXJhY3RlckNvdW50U2l6ZSA9IFs4LCAxNiwgMTZdW3NpemVdO1xuICBjb25zdCBsZW5ndGggPSBzdHJlYW0ucmVhZEJpdHMoY2hhcmFjdGVyQ291bnRTaXplKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGIgPSBzdHJlYW0ucmVhZEJpdHMoOCk7XG4gICAgYnl0ZXMucHVzaChiKTtcbiAgfVxuICB0cnkge1xuICAgIHRleHQgKz0gZGVjb2RlVVJJQ29tcG9uZW50KGJ5dGVzLm1hcChiID0+IGAlJHsoXCIwXCIgKyBiLnRvU3RyaW5nKDE2KSkuc3Vic3RyKC0yKX1gKS5qb2luKFwiXCIpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gZmFpbGVkIHRvIGRlY29kZVxuICB9XG5cbiAgcmV0dXJuIHsgYnl0ZXMsIHRleHQgfTtcbn1cblxuZnVuY3Rpb24gZGVjb2RlS2Fuamkoc3RyZWFtOiBCaXRTdHJlYW0sIHNpemU6IG51bWJlcikge1xuICBjb25zdCBieXRlczogbnVtYmVyW10gPSBbXTtcbiAgbGV0IHRleHQgPSBcIlwiO1xuXG4gIGNvbnN0IGNoYXJhY3RlckNvdW50U2l6ZSA9IFs4LCAxMCwgMTJdW3NpemVdO1xuICBjb25zdCBsZW5ndGggPSBzdHJlYW0ucmVhZEJpdHMoY2hhcmFjdGVyQ291bnRTaXplKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGsgPSBzdHJlYW0ucmVhZEJpdHMoMTMpO1xuXG4gICAgbGV0IGMgPSAoTWF0aC5mbG9vcihrIC8gMHhDMCkgPDwgOCkgfCAoayAlIDB4QzApO1xuICAgIGlmIChjIDwgMHgxRjAwKSB7XG4gICAgICBjICs9IDB4ODE0MDtcbiAgICB9IGVsc2Uge1xuICAgICAgYyArPSAweEMxNDA7XG4gICAgfVxuXG4gICAgYnl0ZXMucHVzaChjID4+IDgsIGMgJiAweEZGKTtcbiAgICB0ZXh0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoc2hpZnRKSVNUYWJsZVtjXSk7XG4gIH1cblxuICByZXR1cm4geyBieXRlcywgdGV4dCB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVjb2RlKGRhdGE6IFVpbnQ4Q2xhbXBlZEFycmF5LCB2ZXJzaW9uOiBudW1iZXIpOiBEZWNvZGVkUVIge1xuICBjb25zdCBzdHJlYW0gPSBuZXcgQml0U3RyZWFtKGRhdGEpO1xuXG4gIC8vIFRoZXJlIGFyZSAzICdzaXplcycgYmFzZWQgb24gdGhlIHZlcnNpb24uIDEtOSBpcyBzbWFsbCAoMCksIDEwLTI2IGlzIG1lZGl1bSAoMSkgYW5kIDI3LTQwIGlzIGxhcmdlICgyKS5cbiAgY29uc3Qgc2l6ZSA9IHZlcnNpb24gPD0gOSA/IDAgOiB2ZXJzaW9uIDw9IDI2ID8gMSA6IDI7XG5cbiAgY29uc3QgcmVzdWx0OiBEZWNvZGVkUVIgPSB7XG4gICAgdGV4dDogXCJcIixcbiAgICBieXRlczogW10sXG4gICAgY2h1bmtzOiBbXSxcbiAgICB2ZXJzaW9uLFxuICB9O1xuXG4gIHdoaWxlIChzdHJlYW0uYXZhaWxhYmxlKCkgPj0gNCkge1xuICAgIGNvbnN0IG1vZGUgPSBzdHJlYW0ucmVhZEJpdHMoNCk7XG4gICAgaWYgKG1vZGUgPT09IE1vZGVCeXRlLlRlcm1pbmF0b3IpIHtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBlbHNlIGlmIChtb2RlID09PSBNb2RlQnl0ZS5FQ0kpIHtcbiAgICAgIGlmIChzdHJlYW0ucmVhZEJpdHMoMSkgPT09IDApIHtcbiAgICAgICAgcmVzdWx0LmNodW5rcy5wdXNoKHtcbiAgICAgICAgICB0eXBlOiBNb2RlLkVDSSxcbiAgICAgICAgICBhc3NpZ25tZW50TnVtYmVyOiBzdHJlYW0ucmVhZEJpdHMoNyksXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmIChzdHJlYW0ucmVhZEJpdHMoMSkgPT09IDApIHtcbiAgICAgICAgcmVzdWx0LmNodW5rcy5wdXNoKHtcbiAgICAgICAgICB0eXBlOiBNb2RlLkVDSSxcbiAgICAgICAgICBhc3NpZ25tZW50TnVtYmVyOiBzdHJlYW0ucmVhZEJpdHMoMTQpLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAoc3RyZWFtLnJlYWRCaXRzKDEpID09PSAwKSB7XG4gICAgICAgIHJlc3VsdC5jaHVua3MucHVzaCh7XG4gICAgICAgICAgdHlwZTogTW9kZS5FQ0ksXG4gICAgICAgICAgYXNzaWdubWVudE51bWJlcjogc3RyZWFtLnJlYWRCaXRzKDIxKSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBFQ0kgZGF0YSBzZWVtcyBjb3JydXB0ZWRcbiAgICAgICAgcmVzdWx0LmNodW5rcy5wdXNoKHtcbiAgICAgICAgICB0eXBlOiBNb2RlLkVDSSxcbiAgICAgICAgICBhc3NpZ25tZW50TnVtYmVyOiAtMSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChtb2RlID09PSBNb2RlQnl0ZS5OdW1lcmljKSB7XG4gICAgICBjb25zdCBudW1lcmljUmVzdWx0ID0gZGVjb2RlTnVtZXJpYyhzdHJlYW0sIHNpemUpO1xuICAgICAgcmVzdWx0LnRleHQgKz0gbnVtZXJpY1Jlc3VsdC50ZXh0O1xuICAgICAgcmVzdWx0LmJ5dGVzLnB1c2goLi4ubnVtZXJpY1Jlc3VsdC5ieXRlcyk7XG4gICAgICByZXN1bHQuY2h1bmtzLnB1c2goe1xuICAgICAgICB0eXBlOiBNb2RlLk51bWVyaWMsXG4gICAgICAgIHRleHQ6IG51bWVyaWNSZXN1bHQudGV4dCxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAobW9kZSA9PT0gTW9kZUJ5dGUuQWxwaGFudW1lcmljKSB7XG4gICAgICBjb25zdCBhbHBoYW51bWVyaWNSZXN1bHQgPSBkZWNvZGVBbHBoYW51bWVyaWMoc3RyZWFtLCBzaXplKTtcbiAgICAgIHJlc3VsdC50ZXh0ICs9IGFscGhhbnVtZXJpY1Jlc3VsdC50ZXh0O1xuICAgICAgcmVzdWx0LmJ5dGVzLnB1c2goLi4uYWxwaGFudW1lcmljUmVzdWx0LmJ5dGVzKTtcbiAgICAgIHJlc3VsdC5jaHVua3MucHVzaCh7XG4gICAgICAgIHR5cGU6IE1vZGUuQWxwaGFudW1lcmljLFxuICAgICAgICB0ZXh0OiBhbHBoYW51bWVyaWNSZXN1bHQudGV4dCxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAobW9kZSA9PT0gTW9kZUJ5dGUuQnl0ZSkge1xuICAgICAgY29uc3QgYnl0ZVJlc3VsdCA9IGRlY29kZUJ5dGUoc3RyZWFtLCBzaXplKTtcbiAgICAgIHJlc3VsdC50ZXh0ICs9IGJ5dGVSZXN1bHQudGV4dDtcbiAgICAgIHJlc3VsdC5ieXRlcy5wdXNoKC4uLmJ5dGVSZXN1bHQuYnl0ZXMpO1xuICAgICAgcmVzdWx0LmNodW5rcy5wdXNoKHtcbiAgICAgICAgdHlwZTogTW9kZS5CeXRlLFxuICAgICAgICBieXRlczogYnl0ZVJlc3VsdC5ieXRlcyxcbiAgICAgICAgdGV4dDogYnl0ZVJlc3VsdC50ZXh0LFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChtb2RlID09PSBNb2RlQnl0ZS5LYW5qaSkge1xuICAgICAgY29uc3Qga2FuamlSZXN1bHQgPSBkZWNvZGVLYW5qaShzdHJlYW0sIHNpemUpO1xuICAgICAgcmVzdWx0LnRleHQgKz0ga2FuamlSZXN1bHQudGV4dDtcbiAgICAgIHJlc3VsdC5ieXRlcy5wdXNoKC4uLmthbmppUmVzdWx0LmJ5dGVzKTtcbiAgICAgIHJlc3VsdC5jaHVua3MucHVzaCh7XG4gICAgICAgIHR5cGU6IE1vZGUuS2FuamksXG4gICAgICAgIGJ5dGVzOiBrYW5qaVJlc3VsdC5ieXRlcyxcbiAgICAgICAgdGV4dDoga2FuamlSZXN1bHQudGV4dCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIElmIHRoZXJlIGlzIG5vIGRhdGEgbGVmdCwgb3IgdGhlIHJlbWFpbmluZyBiaXRzIGFyZSBhbGwgMCwgdGhlbiB0aGF0IGNvdW50cyBhcyBhIHRlcm1pbmF0aW9uIG1hcmtlclxuICBpZiAoc3RyZWFtLmF2YWlsYWJsZSgpID09PSAwIHx8IHN0cmVhbS5yZWFkQml0cyhzdHJlYW0uYXZhaWxhYmxlKCkpID09PSAwKSB7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIl19