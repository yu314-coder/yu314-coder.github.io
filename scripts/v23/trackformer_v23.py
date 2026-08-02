"""Standalone TrackFormer v23 architecture — the best model in this project (434.96 km RMS track
error, 10-seed ensemble, WP+EP 2020+ full-20-lead test set). Chain-of-thought (CoT) steering-flow
prediction (v21) plus a temporal history of that steering representation (v23's addition).

This file has zero notebook/exec tricks: every class below is copied verbatim from the training
scripts that produced the released checkpoints (colab_train_v17.ipynb for TrackFormerV17, the "Base"
that v21/v23 build on; colab_v26_train.py for TrackFormerCoT, v21's chain-of-thought forward pass;
colab_v28_train.py for HistStem/TrackFormerHist, v23's temporal-history addition) -- so this module
IS the architecture the checkpoints were trained with, not a reimplementation from memory. See
run_v23.py for how to load a checkpoint and get a forecast, in either IBTrACS-only or full-steering
mode.
"""
import math
import torch
import torch.nn as nn

# ---- input column layout (54-dim per-6h track/thermo/env feature row) -----------------------
KIN_COLS = [0, 1, 2, 3, 21, 22, 23, 40, 41, 42, 43]
THERMO_COLS = [4, 5, 6, 7] + list(range(8, 20)) + list(range(24, 40)) + [44, 45, 46, 47]
ENV_COLS = [48, 49, 50, 51, 52, 53]
KIN_DIM, THERMO_DIM, ENV_DIM = len(KIN_COLS), len(THERMO_COLS), len(ENV_COLS)

TARGET_SCALE = torch.tensor([100., 100., 35., 20., 50.] + [50.] * 12)

# eval-only: this dict form is a leftover of the training scripts' exec-in-a-dict pattern
# (TrackFormerCoT/TrackFormerHist index into it as G["..."], never as a bare global) -- kept as-is
# rather than rewritten, since these classes are pasted in verbatim from the scripts that actually
# produced the checkpoints. STEER_DROP only affects self.training branches, irrelevant at eval.
G = {"KIN_COLS": KIN_COLS, "THERMO_COLS": THERMO_COLS, "ENV_COLS": ENV_COLS, "STEER_DROP": 0.0}
STEER_DROP = 0.0     # bare-name fallback referenced by TrackFormerV17.forward (never actually
                      # called for v21/v23 -- TrackFormerCoT overrides forward entirely -- kept
                      # only so the class body is valid to define)
USE_FLOW = 1
USE_HIST = 1
KM6H = 6 * 3600 / 1000.0

_i, _j = torch.meshgrid(torch.arange(17) - 8, torch.arange(17) - 8, indexing="ij")
_r = torch.hypot(_i.float(), _j.float()) * 2.5
ANN = ((_r >= 3.0) & (_r <= 8.0)).float()          # 3-8 deg annulus mask matching the training target


def sinusoidal(n, d):
    p = torch.arange(n).unsqueeze(1).float()
    dv = torch.exp(torch.arange(0, d, 2).float() * (-math.log(10000.0) / d))
    e = torch.zeros(n, d); e[:, 0::2] = torch.sin(p * dv); e[:, 1::2] = torch.cos(p * dv)
    return e


def enc(d, h, ffn, dr, depth):
    return nn.TransformerEncoder(nn.TransformerEncoderLayer(d, h, ffn, dr, batch_first=True,
                                 norm_first=True, activation="gelu"), depth)


def dec(d, h, ffn, dr, depth):
    return nn.TransformerDecoder(nn.TransformerDecoderLayer(d, h, ffn, dr, batch_first=True,
                                 norm_first=True, activation="gelu"), depth)


class TrackFormerV17(nn.Module):
    """Base architecture: track/thermo/env history encoders + steering-CNN + cross-attention
    decoders. v21/v23 build on this but override forward() -- it is never called directly for v23,
    kept here only because TrackFormerCoT inherits __init__ from it."""

    def __init__(self, d=256, h=8, ffn=1024, dr=0.15, hist=9, leads=20):
        super().__init__()
        self.leads = leads
        self.kin_proj = nn.Linear(KIN_DIM, d); self.thermo_proj = nn.Linear(THERMO_DIM, d)
        self.env_proj = nn.Linear(ENV_DIM, d)
        self.register_buffer("kin_time", sinusoidal(hist, d).unsqueeze(0))
        self.register_buffer("thermo_time", sinusoidal(hist, d).unsqueeze(0))
        self.register_buffer("env_time", sinusoidal(hist, d).unsqueeze(0))
        self.kin_enc = enc(d, h, ffn, dr, 3); self.thermo_enc = enc(d, h, ffn, dr, 3)
        self.env_enc = enc(d, h, ffn, dr, 2)
        self.track_dec = dec(d, h, ffn, dr, 3); self.int_dec = dec(d, h, ffn, dr, 3)
        self.track_q = nn.Parameter(torch.randn(1, leads, d) * 0.02)
        self.int_q = nn.Parameter(torch.randn(1, leads, d) * 0.02)
        self.register_buffer("qpos", sinusoidal(leads, d))
        self.adapter = nn.Sequential(nn.Linear(d, d), nn.GELU(), nn.Linear(d, d))
        nn.init.zeros_(self.adapter[-1].weight); nn.init.zeros_(self.adapter[-1].bias)
        self.alpha = nn.Parameter(torch.zeros(leads)); self.rho = nn.Parameter(torch.ones(leads))
        self.gturn = nn.Parameter(torch.zeros(leads))
        self.steer_cnn = nn.Sequential(
            nn.Conv2d(4, 24, 3, padding=1), nn.GELU(), nn.Dropout2d(0.10),
            nn.Conv2d(24, 48, 3, stride=2, padding=1), nn.GELU(), nn.Dropout2d(0.10),
            nn.Conv2d(48, d, 3, stride=2, padding=1), nn.GELU())
        self.steer_pos = nn.Parameter(torch.zeros(1, 25, d))
        self.track_res = nn.Linear(d, 2)
        nn.init.zeros_(self.track_res.weight); nn.init.zeros_(self.track_res.bias)
        self.int_state = nn.Linear(d, 15); self.int_logscale = nn.Linear(d, 15)

    def forward(self, track, vpair, slp):
        b = track.shape[0]
        kin = self.kin_enc(self.kin_proj(track[:, :, KIN_COLS]) + self.kin_time)
        thermo = self.thermo_enc(self.thermo_proj(track[:, :, THERMO_COLS]) + self.thermo_time)
        env = self.env_enc(self.env_proj(track[:, :, ENV_COLS]) + self.env_time)
        if self.training and STEER_DROP > 0:
            keep = (torch.rand(b, 1, 1, 1, device=slp.device) >= STEER_DROP).float()
            slp = slp * keep
        st = self.steer_cnn(slp).flatten(2).transpose(1, 2) + self.steer_pos
        tq = (self.track_q + self.qpos.unsqueeze(0)).expand(b, -1, -1)
        h_track = self.track_dec(tq, torch.cat([kin, env, st], dim=1))
        h_track = h_track + self.alpha.view(1, self.leads, 1) * self.adapter(thermo.mean(1).detach()).unsqueeze(1)
        v0, vp = vpair[:, :2], vpair[:, 2:]
        s0 = v0.norm(dim=1, keepdim=True).clamp(min=1e-3)
        phi0 = torch.atan2(v0[:, 1], v0[:, 0])
        dphi = phi0 - torch.atan2(vp[:, 1], vp[:, 0])
        omega = torch.atan2(torch.sin(dphi), torch.cos(dphi))
        phil = phi0.unsqueeze(1) + self.gturn.view(1, self.leads) * omega.unsqueeze(1)
        speed = self.rho.view(1, self.leads) * s0
        base = torch.stack([speed * torch.cos(phil), speed * torch.sin(phil)], dim=-1) / 100.0
        motion = base + self.track_res(h_track)
        iq = (self.int_q + self.qpos.unsqueeze(0)).expand(b, -1, -1)
        h_int = self.int_dec(iq, torch.cat([thermo, env, kin.detach(), st.detach()], dim=1))
        istate = self.int_state(h_int); ilog = self.int_logscale(h_int)
        return torch.cat([motion, istate], -1), torch.cat([torch.zeros_like(motion), ilog], -1)


class TrackFormerCoT(TrackFormerV17):
    """v20's network, with the track derived from a predicted steering flow (v21)."""

    def __init__(self, **kw):
        super().__init__(**kw)
        d = self.track_q.shape[-1]
        self.flow_delta = nn.Linear(d, 2)
        nn.init.zeros_(self.flow_delta.weight); nn.init.zeros_(self.flow_delta.bias)
        self.A = nn.Parameter(torch.tensor([0.76, 0.91]))

    def forward(self, track, vpair, slp):
        b = track.shape[0]
        KIN_COLS, THERMO_COLS, ENV_COLS = G["KIN_COLS"], G["THERMO_COLS"], G["ENV_COLS"]
        STEER_DROP = G["STEER_DROP"]
        kin = self.kin_enc(self.kin_proj(track[:, :, KIN_COLS]) + self.kin_time)
        thermo = self.thermo_enc(self.thermo_proj(track[:, :, THERMO_COLS]) + self.thermo_time)
        env = self.env_enc(self.env_proj(track[:, :, ENV_COLS]) + self.env_time)
        if self.training and STEER_DROP > 0:
            keep = (torch.rand(b, 1, 1, 1, device=slp.device) >= STEER_DROP).float()
            slp = slp * keep
        st = self.steer_cnn(slp).flatten(2).transpose(1, 2) + self.steer_pos
        tq = (self.track_q + self.qpos.unsqueeze(0)).expand(b, -1, -1)
        h_track = self.track_dec(tq, torch.cat([kin, env, st], dim=1))
        h_track = h_track + self.alpha.view(1, self.leads, 1) * self.adapter(thermo.mean(1).detach()).unsqueeze(1)

        w = ANN / ANN.sum()
        sc = torch.as_tensor(DSC, device=slp.device, dtype=slp.dtype)
        flow_now = (slp[:, 2:4] * w).sum((-2, -1)) * sc
        fd = self.flow_delta(h_track)
        flow_pred = flow_now.unsqueeze(1) + fd

        v0, vp = vpair[:, :2], vpair[:, 2:]
        s0 = v0.norm(dim=1, keepdim=True).clamp(min=1e-3)
        phi0 = torch.atan2(v0[:, 1], v0[:, 0])
        dphi = phi0 - torch.atan2(vp[:, 1], vp[:, 0])
        omega = torch.atan2(torch.sin(dphi), torch.cos(dphi))
        phil = phi0.unsqueeze(1) + self.gturn.view(1, self.leads) * omega.unsqueeze(1)
        speed = self.rho.view(1, self.leads) * s0
        base = torch.stack([speed * torch.cos(phil), speed * torch.sin(phil)], dim=-1) / 100.0
        motion = base + self.track_res(h_track)
        if USE_FLOW:
            motion = motion + (self.A.view(1, 1, 2) * fd) * KM6H / 100.0
        iq = (self.int_q + self.qpos.unsqueeze(0)).expand(b, -1, -1)
        h_int = self.int_dec(iq, torch.cat([thermo, env, kin.detach(), st.detach()], dim=1))
        istate = self.int_state(h_int); ilog = self.int_logscale(h_int)
        return (torch.cat([motion, istate], -1),
                torch.cat([torch.zeros_like(motion), ilog], -1), flow_pred)


class HistStem(nn.Module):
    """v17's steering stem, plus a zero-initialised residual carrying t-12h and t-24h (v23)."""

    def __init__(self, base, ch):
        super().__init__()
        self.base = base
        self.stem = nn.Sequential(
            nn.Conv2d(10, 24, 3, padding=1), nn.GELU(), nn.Dropout2d(0.10),
            nn.Conv2d(24, 48, 3, stride=2, padding=1), nn.GELU(), nn.Dropout2d(0.10),
            nn.Conv2d(48, ch, 3, stride=2, padding=1), nn.GELU())
        self.out = nn.Conv2d(ch, ch, 1)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)
        self.ctx = None

    def forward(self, slp):
        st = self.base(slp)
        if USE_HIST and self.ctx is not None:
            hist, have = self.ctx
            hv = have.view(-1, 2, 1, 1).expand(-1, 2, hist.shape[-2], hist.shape[-1])
            st = st + self.out(self.stem(torch.cat([hist, hv], 1)))
        return st


class TrackFormerHist(TrackFormerCoT):
    """v23: v21 + a temporal history of the steering representation (t-12h, t-24h). This is the
    class the released v23 checkpoints instantiate."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.steer_cnn = HistStem(self.steer_cnn, self.steer_pos.shape[-1])

    def forward(self, tr, vp, slp, hist=None, have=None):
        sd = G["STEER_DROP"]
        drop = self.training and sd > 0 and hist is not None
        if drop:
            keep = (torch.rand(tr.shape[0], 1, 1, 1, device=slp.device) >= sd).float()
            slp = slp * keep
            hist = hist * keep
            have = have * keep.view(-1, 1)
            G["STEER_DROP"] = 0.0
        self.steer_cnn.ctx = (hist, have) if hist is not None else None
        try:
            return super().forward(tr, vp, slp)
        finally:
            self.steer_cnn.ctx = None
            G["STEER_DROP"] = sd


# ---- loaded at import time from the small companion norm-stats file --------------------------
import os as _os
import numpy as _np

_stats = _np.load(_os.path.join(_os.path.dirname(__file__), "v23_norm_stats.npz"))
TMEAN = _stats["tmean"]           # (54,) float32 -- per-column track/thermo/env feature mean
TSTD = _stats["tstd"]             # (54,) float32 -- per-column std
DSC = _stats["dsc"]               # (2,) float32 -- deep-layer-mean steering u/v de-normalization scale
TARGET_SCALE = torch.from_numpy(_stats["target_scale"])   # (17,) -- motion(2)+intensity(15) scale


def build_v23():
    """Returns an uninitialized TrackFormerHist -- load_state_dict a v23_seed*.pt checkpoint,
    call .eval()."""
    return TrackFormerHist()
