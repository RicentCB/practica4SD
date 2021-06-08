const getRandom = maxNum => (Math.floor(Math.random() * maxNum));

const dayInMillis = 24 * 60 * 60 * 1000;
const hourInMillis = 60 * 60 * 1000;
const minuteInMillis = 60 * 1000;

function mod(n, b) {
    if (n > b) {
        return n - b;
    } else {
        return n;
    }
}

export default class Clock {
    constructor(hours, mins, secs, millis) {
        let now = new Date();
        hours = mod((hours ?? now.getHours()), 24);
        mins = mod((mins ?? now.getMinutes()), 60);
        secs = mod((secs ?? now.getSeconds()), 60);
        millis = mod((millis ?? now.getMilliseconds()), 1000);
        this._millis = hours * hourInMillis + mins * minuteInMillis + secs * 1000 + millis;
    }
    get time() {
        let hours = Math.floor(this._millis / hourInMillis);
        let minutes = Math.floor((this._millis - hours * hourInMillis) / minuteInMillis);
        let seconds = Math.floor((this._millis - minutes * minuteInMillis - hours * hourInMillis) / 1000);
        let millis = this._millis - hours * hourInMillis - minutes * minuteInMillis - seconds * 1000;
        return {
            hours: hours,
            minutes: minutes,
            seconds: seconds,
            millis: millis
        };
    }

    get millis() {
        return this._millis
    };

    set time(newTime) {
        newTime.hours = mod(newTime.hours, 24);
        newTime.mins = mod(newTime.mins, 60);
        newTime.secs = mod(newTime.secs, 60);
        newTime.millis = mod(newTime.millis, 1000);
        this._millis = newTime.hours * hourInMillis + newTime.mins * minuteInMillis + newTime.secs * 1000 + newTime.millis;
    }
    advance(millis) {
        millis = millis ?? 1;
        this._millis = mod(this._millis + millis, dayInMillis);
    }
}

