const asDoubleDigit = num => ((num < 10) ? ("0" + num) : num.toString());

const updateClockDom = (domElement, clock) => {
    domElement.querySelector("h1.hours").innerHTML = asDoubleDigit(clock?.hours);
    domElement.querySelector("h1.mins").innerHTML = asDoubleDigit(clock?.minutes);
    domElement.querySelector("h1.secs").innerHTML = asDoubleDigit(clock?.seconds);
}

const appendLogClock = (domElement, clockData) => {
    let par = document.createElement('p');
    par.appendChild(document.createTextNode(
        `${asDoubleDigit(clockData?.hours)} :
        ${asDoubleDigit(clockData?.minutes)} :
        ${asDoubleDigit(clockData?.seconds)}
        `
    ));
    domElement.appendChild(par);
    domElement
    if(domElement.childElementCount >25)
        domElement.removeChild(domElement.getElementsByTagName('p')[0]);
    domElement.scrollTop = domElement.scrollHeight;
}

export {
    asDoubleDigit,
    updateClockDom,
    appendLogClock
}