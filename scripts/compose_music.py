#!/usr/bin/env python3
"""Render five original Plouf instrumental compositions (numpy + ffmpeg)."""
from pathlib import Path
import math
import subprocess
import tempfile
import wave
import numpy as np

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]
RNG = np.random.default_rng(4126)


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def instrument(note, duration, voice):
    t = np.arange(int(duration * RATE)) / RATE
    f = frequency(note)
    if voice == 'bell':
        x = sum(a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * decay)
                for ratio, a, decay in [(1, 1, 2.4), (2, .28, 4), (3.01, .10, 7), (4.18, .05, 10)])
        attack = .008
    elif voice == 'harp':
        x = sum(np.sin(2 * np.pi * f * h * t) * np.exp(-t * (2 + h * .8)) / h ** 1.65
                for h in range(1, 8))
        attack = .009
    elif voice == 'marimba':
        x = np.sin(2 * np.pi * f * t) * np.exp(-t * 5) + .22 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 18)
        attack = .004
    elif voice == 'flute':
        phase = 2 * np.pi * f * t + .025 * np.sin(2 * np.pi * 4.8 * t)
        x = (np.sin(phase) + .12 * np.sin(phase * 2) + .045 * np.sin(phase * 3)) * np.exp(-t * .65)
        attack = .065
    elif voice == 'brass':
        phase = 2 * np.pi * f * t + .018 * np.sin(2 * np.pi * 5 * t)
        x = sum(np.sin(phase * h) / h ** 1.7 for h in range(1, 7)) * np.exp(-t * 2)
        attack = .028
    elif voice == 'bass':
        x = (np.sin(2 * np.pi * f * t) + .22 * np.sin(2 * np.pi * f * 2 * t)) * np.exp(-t * 3)
        attack = .012
    else:
        x = sum(np.sin(2 * np.pi * f * (1 + cents) * t + phase) * amplitude
                for cents, phase, amplitude in [(0, 0, .65), (.0018, .2, .2), (-.0017, .4, .15)])
        x += .12 * np.sin(2 * np.pi * f * 2 * t)
        attack = .35
    envelope = np.minimum(t / attack, 1) * np.minimum(np.maximum(duration - t, 0) / min(.22, duration / 3), 1)
    return (x * envelope).astype(np.float32)


def render(name, bpm, beats, chords, melodies, lead):
    beat = 60 / bpm
    bars = len(chords)
    music_end = bars * beats * beat
    duration = music_end + 1.1
    mix = np.zeros((int(duration * RATE), 2), np.float32)

    def add(note, at, length, voice, gain=.12, pan=0):
        if note is None:
            return
        x = instrument(note, length, voice) * gain
        start = round(at * RATE)
        n = min(len(x), len(mix) - start)
        if n <= 0:
            return
        mix[start:start+n, 0] += x[:n] * math.sqrt((1-pan)/2)
        mix[start:start+n, 1] += x[:n] * math.sqrt((1+pan)/2)

    def percussion(at, kind, gain):
        length = .28 if kind in ('kick','clap') else .15
        t = np.arange(int(length*RATE))/RATE
        noise = RNG.standard_normal(len(t))
        if kind == 'kick':
            phase = 2*np.pi*(47*t + 4*(1-np.exp(-t*30)))
            x = np.sin(phase)*np.exp(-t*19)
        elif kind == 'clap':
            x = (noise - np.roll(noise,1)) * np.exp(-t*35) * .25
            x *= .4+.6*(np.sin(t*330)**2)
        elif kind == 'sleigh':
            x = sum(np.sin(2*np.pi*f*t) for f in [2810,3371,4217,5489])*.18*np.exp(-t*28)
        else:
            x = (noise-np.roll(noise,1))*.12*np.exp(-t*45)
        i = round(at*RATE);n=min(len(x),len(mix)-i)
        mix[i:i+n,0] += x[:n]*gain*.65
        mix[i:i+n,1] += x[:n]*gain*.75

    for bar,chord in enumerate(chords):
        start = bar * beats * beat
        # Warm sustained harmony, with a light acoustic arpeggio underneath.
        for j,note in enumerate(chord):
            add(note, start, beats*beat+.55, 'pad', .027, (j-1)*.32)
        add(chord[0]-24,start,beat*1.4,'bass',.18)
        if beats == 4:
            add(chord[0]-24,start+2*beat,beat*1.3,'bass',.13)
        for step in range(beats*2):
            n=chord[step%len(chord)]+(12 if step%4==3 else 0)
            add(n,start+step*beat/2,beat*.85,'harp' if name!='underwater' else 'marimba',.045,(-1 if step%2 else 1)*.45)
        phrase=melodies[bar%len(melodies)]
        for step,note in enumerate(phrase):
            if note is not None:
                length=beat*(.82 if name=='podium' else 1.1)
                add(note,start+step*beats*beat/len(phrase),length,lead,.14 if name!='forest' else .115,.05)
                if name=='christmas' and bar>=8:
                    add(note-12,start+step*beats*beat/len(phrase),length,'flute',.035,-.25)
        if name=='lobby':
            for b in range(4):
                if b%2:percussion(start+b*beat,'clap',.07)
                else:percussion(start+b*beat,'kick',.1)
                percussion(start+(b+.5)*beat,'shaker',.09)
        elif name=='christmas':
            for b in range(beats):
                percussion(start+b*beat,'sleigh',.12 if b else .17)
                if b:
                    for n in chord:add(n,start+b*beat,beat*.6,'harp',.04,.2)
        elif name=='forest':
            if bar%2==0:add(chord[2]+24,start+2.5*beat,beat*1.5,'bell',.035,-.5)
        elif name=='underwater':
            for b in range(8):
                percussion(start+(b*.5+(.07 if b%2 else 0))*beat,'shaker',.15)
            percussion(start,'kick',.12)
            percussion(start+2.5*beat,'kick',.08)
        else:
            for b in range(4):
                percussion(start+b*beat,'kick',.22)
                if b%2:percussion(start+b*beat,'clap',.19)
                percussion(start+(b+.5)*beat,'shaker',.24)
            for j,n in enumerate(chord):add(n+12,start+1.5*beat,.2,'brass',.035,j*.2-.2)
    # Stereo room reflections and a soft reverb tail; no hard loop cut.
    dry=mix.copy()
    for delay,gain in [(.073,.12),(.139,.09),(.241,.075),(.367,.055),(.519,.035)]:
        n=round(delay*RATE);mix[n:]+=dry[:-n,::-1]*gain
    t=np.arange(len(mix))/RATE
    mix*=np.minimum(t/.12,1)[:,None]
    mix*=np.minimum(np.maximum(duration-t,0)/1.25,1)[:,None]
    mix=np.tanh(mix*1.3)
    peak=float(np.max(np.abs(mix)))
    mix*=.78/max(peak,.001)
    out=ROOT/'public'/'audio'/f'{name}.mp3'
    with tempfile.TemporaryDirectory() as directory:
        wav=Path(directory)/'track.wav'
        with wave.open(str(wav),'wb') as f:
            f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
            f.writeframes((mix*32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k','-metadata',f'title=Plouf {name}','-metadata','artist=Plouf original instrumental',str(out)],check=True)
    print(f'{out.name}: {duration:.1f}s, {out.stat().st_size//1024} KB')


if __name__=='__main__':
    C=[60,64,67];F=[60,65,69];G=[59,62,67];Am=[60,64,69]
    render('lobby',76,4,[[57,60,64,67],[53,57,60,64],[60,64,67,71],[55,59,62,69]]*3,
           [[76,None,None,72,None,79,None,None],[77,None,76,None,72,None,None,None],
            [79,None,None,83,None,76,None,None],[74,None,71,None,67,None,None,None]],'harp')
    render('christmas',112,3,[C,F,C,G,Am,F,G,C]*3,
           [[76,79,81,79,76,72],[77,81,84,81,79,77],[76,79,83,79,76,74],[74,79,77,74,71,67],
            [76,81,84,83,81,76],[77,81,79,77,74,72],[74,77,79,83,81,79],[76,74,72,None,72,None]],'bell')
    render('forest',88,3,[Am,F,C,G,Am,F,G,C]*2,
           [[81,None,84,83,79,76],[81,84,None,89,88,84],[79,None,84,88,86,84],[83,86,88,None,86,83],
            [88,84,81,None,79,76],[81,84,89,88,None,84],[86,83,79,83,86,83],[84,None,79,76,72,None]],'flute')
    render('underwater',96,4,[[57,60,64,67],[53,57,60,64],[60,64,67,71],[55,59,62,69]]*4,
           [[76,None,79,81,None,79,76,72],[72,76,None,77,81,None,79,76],
            [79,None,83,86,83,None,79,76],[74,79,None,81,79,74,71,None]],'marimba')
    render('podium',124,4,[C,G,Am,F,C,F,G,C]*2,
           [[72,76,79,None,84,83,79,76],[74,79,83,86,None,83,81,79],
            [81,None,84,88,86,84,81,79],[77,81,84,None,89,88,84,81],
            [84,79,76,79,84,None,88,86],[89,88,84,81,None,84,81,77],
            [79,83,86,89,88,86,83,79],[84,None,79,76,72,None,84,None]],'brass')
