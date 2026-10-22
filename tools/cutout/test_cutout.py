"""The ground check, the shape check, the white edge and the tool's reading of
a photo beside the model's answer, on synthetic photos and masks — no model
and no network needed.

    python -m unittest tools/cutout/test_cutout.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from cutout import cut_alpha, cut_one, ground_check, level, shape_check, status_of, unmix_white


def rect(h, w, y0, y1, x0, x1):
    mask = np.zeros((h, w), np.float32)
    mask[y0:y1, x0:x1] = 1.0
    return mask


class ShapeCheck(unittest.TestCase):
    def test_a_whole_pack_is_left_alone(self):
        mask = rect(200, 160, 20, 180, 20, 140)
        alpha, report = shape_check(mask)
        self.assertEqual(report["dents"], [])
        self.assertEqual(report["holes"], 0.0)
        np.testing.assert_allclose(alpha, mask)

    def test_an_enclosed_hole_is_filled(self):
        mask = rect(200, 160, 20, 180, 20, 140)
        mask[80:120, 60:100] = 0.0  # a printed white panel the model dropped
        alpha, report = shape_check(mask)
        self.assertGreater(report["holes"], 0.05)
        self.assertTrue((alpha[85:115, 65:95] > 0.99).all())

    def test_a_deep_bite_into_a_box_is_filled_and_the_box_restored(self):
        # As on the Lavazza Intenso box: the model cut round a printed cup up
        # from the bottom edge, and never reached the bottom-right corner.
        mask = rect(200, 160, 20, 180, 20, 140)
        mask[80:180, 50:120] = 0.0
        mask[160:180, 125:140] = 0.0
        alpha, report = shape_check(mask)
        self.assertEqual(len(report["dents"]), 1)
        self.assertGreater(report["dents"][0]["depth"], 0.30)
        self.assertGreater(report["box"], 0.90)
        self.assertTrue((alpha[90:170, 60:110] > 0.99).all())
        self.assertTrue((alpha[163:175, 128:136] > 0.99).all())  # the corner, back

    def test_a_shallow_gap_beside_a_round_badge_stays_a_gap(self):
        mask = rect(200, 200, 40, 180, 20, 150)
        yy, xx = np.mgrid[0:200, 0:200]
        mask[(yy - 45) ** 2 + (xx - 155) ** 2 < 30 ** 2] = 1.0  # an "x100" badge on the corner
        alpha, report = shape_check(mask)
        self.assertEqual(report["dents"], [])
        self.assertLess(alpha[15, 60], 0.01)  # the ground above the pouch stays ground


def photo(h=260, w=200):
    """A levelled packshot: white ground."""
    return np.full((h, w, 3), 255.0, np.float32)


def striped(rgb, y0, y1, x0, x1, dark=(30.0, 30.0, 110.0), light=(150.0, 60.0, 30.0)):
    """A dark printed box: coloured vertical stripes, so every row has a pattern."""
    for x in range(x0, x1):
        rgb[y0:y1, x] = dark if (x // 6) % 2 else light


def printed(rgb, y0, y1, x0, x1):
    """A dark printed box whose rows share one pattern, stronger or weaker."""
    rng = np.random.default_rng(2)
    rows = rng.uniform(20, 140, (y1 - y0, 1, 1))
    cols = rng.uniform(0.6, 1.0, (1, x1 - x0, 1))
    rgb[y0:y1, x0:x1] = rows * cols * np.array([1.0, 0.7, 0.5])


def pictured(rgb, y0, y1, x0, x1):
    """A dark printed box with a picture on it: large shapes, every row its own."""
    field = ndimage.gaussian_filter(np.random.default_rng(2).normal(0, 1, (y1 - y0, x1 - x0)), 5)
    field = (field - field.min()) / (field.max() - field.min())
    rgb[y0:y1, x0:x1] = (20 + 120 * field)[..., None] * np.array([1.0, 0.7, 0.5])


class GroundCheck(unittest.TestCase):
    def test_a_box_the_model_missed_round_its_printed_cup_is_found_whole(self):
        # As on Rema Cortado and Lollo Giove under the BiRefNet models: the cup
        # printed on the box was cut out, and the box went missing round it.
        rgb = photo()
        rgb[40:200, 40:160] = 40.0
        yy, xx = np.mgrid[0:260, 0:200]
        cup = (yy - 120) ** 2 + (xx - 100) ** 2 < 30 ** 2
        rgb[cup] = 230.0
        for y in range(200, 232):  # a soft shadow fading out under it
            rgb[y, 40:160] = 200.0 + (y - 200) * 55.0 / 32
        alpha, report = ground_check(rgb, cup.astype(np.float32))
        self.assertTrue((alpha[44:196, 44:156] > 0.99).all())
        self.assertTrue((alpha[205:232, 40:160] < 0.01).all())  # the shadow stays ground
        self.assertGreater(report["added"], 0.5)
        self.assertEqual(status_of(cut_alpha(rgb, cup * 1.0)[1]), "pending")

    def reflected(self, blur):
        """A printed box on a glossy floor, its reflection under it; the model
        took part of the reflection for the box."""
        rgb = photo()
        if blur:
            pictured(rgb, 40, 140, 40, 160)
        else:
            printed(rgb, 40, 140, 40, 160)
        for j in range(0, 70):  # the box upside down, fading into the floor
            rgb[142 + j, 40:160] = 0.45 * rgb[139 - j, 40:160] + 0.55 * 255.0
        if blur:
            rgb[142:212] = ndimage.gaussian_filter(rgb[142:212], (blur, blur, 0))
            rgb[142:212] += np.random.default_rng(1).normal(0, 5, (70, 200, 1))
        greedy = rect(260, 200, 40, 140, 40, 160)
        greedy[142:180, 40:100] = 1.0
        return rgb, greedy

    def test_a_sharp_reflection_in_the_cut_is_shown_to_a_person_unchanged(self):
        # As on Bianchi Gusto Forte under BiRefNet lite: each row under the
        # box is a row of it, faded toward white. Its rows look alike, so
        # pairing them upside down is no better than the right way up.
        rgb, greedy = self.reflected(blur=0)
        alpha, shape = cut_alpha(rgb, greedy)
        self.assertTrue(shape["reflection"])
        self.assertEqual(status_of(shape), "pending")
        self.assertTrue((alpha[150:178, 44:96] > 0.99).all())  # left as the model cut it

    def test_a_blurred_reflection_in_the_cut_is_shown_to_a_person_too(self):
        # As on Caffitaly Panettone: too soft to be a faded copy row by row,
        # but it still pairs up better upside down than the right way up.
        rgb, greedy = self.reflected(blur=2.5)
        _, shape = cut_alpha(rgb, greedy)
        self.assertTrue(shape["reflection"])
        self.assertEqual(status_of(shape), "pending")

    def test_a_reflection_the_model_left_out_is_not_added_back(self):
        # The model cut the box exactly; under it the glossy floor holds a
        # coloured, patterned reflection the ground cannot reach. It is not
        # the pack, so nothing under the base is added.
        rgb = photo()
        striped(rgb, 40, 140, 40, 160)
        for j in range(0, 70):  # right at the base: it touches the box
            rgb[140 + j, 40:160] = 0.45 * rgb[139 - j, 40:160] + 0.55 * 255.0
        box = rect(260, 200, 40, 140, 40, 160)
        alpha, shape = cut_alpha(rgb, box)
        self.assertEqual(shape["added"], 0.0)
        self.assertEqual(status_of(shape), "auto")
        self.assertTrue((alpha[144:210] < 0.01).all())

    def test_a_bag_with_a_light_lower_panel_is_no_reflection(self):
        # As on Elia Vending: a dark band over a light panel is no floor, and
        # the panel is no reflection of the band, though the bag's pillow
        # shading runs through both.
        rng = np.random.default_rng(0)
        rgb = photo()
        rgb[40:160, 50:150] = np.array([70.0, 45.0, 30.0]) + rng.normal(0, 6, (120, 100, 1))
        rgb[160:220, 50:150] = np.array([235.0, 225.0, 205.0]) + rng.normal(0, 3, (60, 100, 1))
        pillow = 1 - 0.3 * ((np.arange(50, 150) - 100) / 50.0) ** 2
        rgb[40:220, 50:150] *= pillow[None, :, None]
        bag = rect(260, 200, 40, 220, 50, 150)
        alpha, shape = cut_alpha(rgb, bag)
        self.assertTrue((alpha[164:216, 54:146] > 0.99).all())
        self.assertFalse(shape["reflection"])
        self.assertEqual(status_of(shape), "auto")

    def test_a_small_change_is_not_made_and_the_cut_goes_live_as_the_model_drew_it(self):
        # A small logo reflected under a cream box, no floor line found under
        # a box so light: too small to be worth a person's look, so not added.
        rgb = photo(300, 240)
        rgb[30:270, 20:220] = [240.0, 236.0, 222.0]
        rgb[270:284, 100:114] = [200.0, 40.0, 40.0]
        box = rect(300, 240, 30, 270, 20, 220)
        soft_edge = ndimage.gaussian_filter(box, 1.5)
        alpha, shape = cut_alpha(rgb, soft_edge)
        self.assertEqual((shape["added"], shape["reflection"]), (0.0, False))
        self.assertEqual(status_of(shape), "auto")
        np.testing.assert_allclose(alpha, shape_check(np.clip((soft_edge - 0.08) / 0.88, 0, 1))[0])
        self.assertTrue((alpha[274:284, 102:112] == 0).all())
        self.assertGreater(alpha[270, 60], 0.0)  # the model's soft edge is kept

    def test_a_hole_still_sends_the_cut_out_to_a_person(self):
        # A hang hole the model left open shows the ground: the shape check
        # fills it, and only a person can say whether it should be.
        rgb = photo()
        printed(rgb, 40, 200, 40, 160)
        rgb[60:68, 96:104] = 255.0
        pod = rect(260, 200, 40, 200, 40, 160)
        pod[60:68, 96:104] = 0.0
        _, shape = cut_alpha(rgb, pod)
        self.assertGreater(shape["holes"], 0.001)
        self.assertEqual(status_of(shape), "pending")
        # Also when the model missed the pod's lower part, and the ground
        # check puts it back: the hole is still reported as a hole.
        top = pod.copy()
        top[140:200] = 0.0
        _, shape = cut_alpha(rgb, top)
        self.assertGreater(shape["added"], 0.2)
        self.assertGreater(shape["holes"], 0.001)

    def test_the_rim_of_an_outline_is_no_miss(self):
        # The model got the box; the dark band just outside one side is the
        # box's own edge, which it drew a few pixels in.
        rgb = photo()
        striped(rgb, 40, 200, 40, 160)
        rgb[40:200, 160:168] = [40.0, 30.0, 90.0]
        box = rect(260, 200, 40, 200, 40, 160)
        alpha, shape = cut_alpha(rgb, box)
        self.assertEqual(shape["added"], 0.0)
        self.assertEqual(status_of(shape), "auto")
        self.assertTrue((alpha[40:200, 163:168] < 0.5).all())

    def test_a_drop_shadow_beside_a_flat_pod_is_no_miss(self):
        # A pod photographed from above casts a grey shadow down and to the
        # right, wide and with a hard edge, so the ground cannot take it.
        rgb = photo()
        rgb[56:206, 56:176] = 205.0
        striped(rgb, 40, 190, 40, 160)
        pod = rect(260, 200, 40, 190, 40, 160)
        alpha, shape = cut_alpha(rgb, pod)
        self.assertEqual(shape["added"], 0.0)
        self.assertTrue((alpha[192:206, 60:176] < 0.5).all())

    def test_a_light_box_whose_top_the_model_missed_is_found_through_a_gap(self):
        # As on Foodness Mermaid Latte under the BiRefNet models: a cream box
        # on white lost its top band, and its outline has a narrow soft gap
        # the ground must not pour in through.
        rgb = photo()
        cream = np.array([240.0, 236.0, 222.0])
        rgb[40:200, 30:170] = cream
        rgb[60:70, 60:140] = 90.0  # a printed title
        for y in range(34, 47):  # the gap: four columns fading in smoothly
            rgb[y, 60:64] = 255.0 - (y - 34) / 12 * (255.0 - cream)
        lower = rect(260, 200, 90, 200, 30, 170)
        alpha, report = ground_check(rgb, lower)
        self.assertTrue((alpha[44:88, 34:166] > 0.99).all())
        self.assertGreater(report["added"], 0.2)


class Kept(unittest.TestCase):
    """What the model kept beyond the pack: shown to a person, never removed."""

    def test_a_shadow_the_model_kept_beside_the_pack_is_shown_to_a_person(self):
        rgb = photo()
        striped(rgb, 40, 200, 40, 120)
        for x in range(120, 170):  # a soft grey shadow fading out to the right
            rgb[60:200, x] = 200.0 + (x - 120) * 55.0 / 50
        greedy = rect(260, 200, 40, 200, 40, 160)
        alpha, shape = cut_alpha(rgb, greedy)
        self.assertGreater(shape["kept"], 0.05)
        self.assertEqual(status_of(shape), "pending")
        self.assertTrue((alpha[70:190, 125:155] > 0.99).all())  # reported, not removed

    def test_a_cut_that_reaches_the_frame_kept_the_backdrop(self):
        # The backdrop, levelled to white, is no shadow; only reaching the
        # frame gives it away.
        rgb = photo()
        striped(rgb, 60, 200, 60, 140)
        backdrop = rect(260, 200, 3, 257, 3, 197)
        _, shape = cut_alpha(rgb, backdrop)
        self.assertEqual(shape["kept"], 0.0)
        self.assertTrue(shape["framed"])
        self.assertEqual(status_of(shape), "pending")

    def test_a_light_panel_within_the_pack_print_is_no_kept_shadow(self):
        # A pale grey panel between the pack's printed bands, open at the
        # sides where the box has no outline: inside the print, so the pack's.
        rgb = photo()
        rgb[40:220, 40:160] = 246.0
        striped(rgb, 40, 80, 40, 160)
        striped(rgb, 180, 220, 40, 160)
        box = rect(260, 200, 40, 220, 40, 160)
        _, shape = cut_alpha(rgb, box)
        self.assertEqual(shape["kept"], 0.0)
        self.assertEqual(status_of(shape), "auto")

    def test_a_white_box_with_a_blank_border_is_shown_to_a_person(self):
        # The ground check cannot tell a white box's blank border from a
        # shadow; the model's word is not enough, so a person looks.
        rgb = photo()
        rgb[40:220, 30:170] = 246.0  # a white box, a shade off the ground, no outline to speak of
        striped(rgb, 150, 200, 70, 130)  # its print, low and narrow
        box = rect(260, 200, 40, 220, 30, 170)
        _, shape = cut_alpha(rgb, box)
        self.assertGreater(shape["kept"], 0.005)
        self.assertEqual(status_of(shape), "pending")


def answer(folder, size=(220, 300), mode="RGBA", alpha=True):
    """A photo with a pack on its grey ground, and the model's answer for it."""
    w, h = size
    canvas = np.full((h, w, 3), 255, np.uint8)
    canvas[h // 8:h - h // 8, w // 8:w - w // 8] = 246
    canvas[h * 3 // 10:h * 8 // 10, w * 3 // 10:w * 7 // 10] = [40, 30, 90]
    Image.fromarray(canvas).save(Path(folder) / "photo.png")
    cut = np.zeros((h, w, 4), np.uint8)
    cut[h * 3 // 10:h * 8 // 10, w * 3 // 10:w * 7 // 10] = [40, 30, 90, 255 if alpha else 0]
    image = Image.fromarray(cut, "RGBA")
    (image if mode == "RGBA" else image.convert(mode)).save(Path(folder) / "photo.model.png")
    return Path(folder) / "photo.png", Path(folder) / "photo.model.png"


class Reading(unittest.TestCase):
    def test_an_answer_that_is_no_cut_out_of_this_photo_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            photo_path, model_path = answer(folder, mode="RGB")
            with self.assertRaisesRegex(ValueError, "no transparency"):
                cut_one(photo_path, model_path)
            photo_path, model_path = answer(folder)
            Image.open(model_path).resize((110, 150)).save(model_path)
            with self.assertRaisesRegex(ValueError, "the model's answer is"):
                cut_one(photo_path, model_path)
            photo_path, model_path = answer(folder, alpha=False)
            with self.assertRaisesRegex(ValueError, "all clear or all solid"):
                cut_one(photo_path, model_path)

    def test_a_photo_larger_than_the_tool_works_on_still_lines_up(self):
        with tempfile.TemporaryDirectory() as folder:
            cut, shape = cut_one(*answer(folder, size=(1600, 2400)))
        width, height = cut.size  # the pack, at half the size, give or take its soft edge
        self.assertLessEqual(abs(width - 320), 3)
        self.assertLessEqual(abs(height - 600), 3)
        self.assertEqual(status_of(shape), "auto")

    def test_the_tool_reads_each_photo_beside_its_answer(self):
        with tempfile.TemporaryDirectory() as folder:
            given, made = Path(folder) / "in", Path(folder) / "out"
            given.mkdir()
            answer(given)
            (given / "photo.png").rename(given / "aa.png")
            (given / "photo.model.png").rename(given / "aa.model.png")
            Image.fromarray(np.full((50, 50, 3), 120, np.uint8)).save(given / "bb.jpg")
            run = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("cutout.py")), str(given), str(made)],
                capture_output=True, text=True, check=True,
            )
            report = json.loads((made / "report.json").read_text())
            self.assertEqual(sorted(report), ["aa", "bb"])  # the answer is no photo of its own
            self.assertEqual(report["aa"]["status"], "auto")
            self.assertTrue((made / "aa.png").exists())
            self.assertIn("missing", report["bb"]["error"])
            self.assertIn('"aa"', run.stdout)

    def test_the_models_cut_out_is_framed_as_the_photo_is(self):
        # The model answers at the photo's own size; the tool works on the
        # photo cropped out of its white canvas, so the answer must be cropped
        # the same way, or the pack and its mask would not line up.
        with tempfile.TemporaryDirectory() as folder:
            canvas = np.full((300, 220, 3), 255, np.uint8)
            canvas[40:280, 30:200] = 246  # the photo's light-grey ground
            canvas[90:250, 70:160] = [40, 30, 90]  # the pack
            Image.fromarray(canvas).save(Path(folder) / "photo.png")
            answer = np.zeros((300, 220, 4), np.uint8)
            answer[90:250, 70:160] = [40, 30, 90, 255]
            Image.fromarray(answer, "RGBA").save(Path(folder) / "photo.model.png")
            cut, shape = cut_one(Path(folder) / "photo.png", Path(folder) / "photo.model.png")
        self.assertEqual(cut.size, (90, 160))
        self.assertEqual(status_of(shape), "auto")
        pixels = np.asarray(cut)
        self.assertTrue((pixels[..., 3] == 255).all())
        self.assertLess(float(np.abs(pixels[..., :3].astype(float) - [41, 31, 93]).max()), 6)


class Edge(unittest.TestCase):
    def test_white_is_unmixed_from_a_soft_edge(self):
        red = np.array([200.0, 30.0, 30.0])
        a = 0.5
        mixed = a * red + (1 - a) * 255.0
        out = unmix_white(mixed.reshape(1, 1, 3), np.array([[a]]))
        np.testing.assert_allclose(out[0, 0], red, atol=0.5)

    def test_the_ground_is_levelled_and_the_canvas_cropped(self):
        canvas = np.full((120, 80, 3), 255.0)
        canvas[30:90, 10:70] = 246.0  # the photo's light-grey ground
        canvas[50:70, 30:50] = [120.0, 60.0, 20.0]  # the pack
        out = level(canvas)
        self.assertLess(out.shape[0], 120)
        self.assertAlmostEqual(float(out[15, 15].mean()), 255.0, delta=0.5)


if __name__ == "__main__":
    unittest.main()
