import re
import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr, standard_transformations, implicit_multiplication_application,
    convert_xor,
)

x, y, z = sp.symbols("x y z")
TRANSFORMS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)
ALLOWED = {
    "x", "y", "z", "a", "b", "c", "r", "pi", "e",
    "sin", "cos", "tan", "asin", "acos", "atan",
    "sqrt", "log", "ln", "abs", "factorial",
}
LOCAL = {
    "x": x, "y": y, "z": z, "a": sp.Symbol("a"),
    "b": sp.Symbol("b"), "c": sp.Symbol("c"), "r": sp.Symbol("r"),
    "pi": sp.pi, "e": sp.E, "sin": sp.sin, "cos": sp.cos,
    "tan": sp.tan, "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sqrt": sp.sqrt, "log": sp.log, "ln": sp.log, "abs": sp.Abs,
    "factorial": sp.factorial,
}


def _parse(text):
    names = re.findall(r"[A-Za-z_]+", text)
    if any(n.lower() not in ALLOWED for n in names):
        raise ValueError("unknown name")
    if not re.fullmatch(r"[0-9A-Za-z_+\-*/^().,! \t]+", text):
        raise ValueError("unsupported characters")
    return parse_expr(
        text, local_dict=LOCAL, transformations=TRANSFORMS,
        evaluate=True,
    )


def _number_after(text, word):
    match = re.search(r"(?:" + word + r")\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)", text)
    if not match:
        raise ValueError("missing dimension")
    return sp.Rational(match.group(1).replace(",", "."))


def _geometry(q):
    s = q.lower().replace(",", ".")
    try:
        if any(w in s for w in ("кубоид", "параллелепипед", "прямоугольный брус")):
            a = _number_after(s, r"(?:длин\w*|длина|a)")
            b = _number_after(s, r"(?:ширин\w*|ширина|b)")
            c = _number_after(s, r"(?:высот\w*|высота|c)")
            return f"Объём прямоугольного параллелепипеда V = a·b·h.\nV = {a}·{b}·{c} = {sp.sstr(a*b*c)} кубических единиц."
        if "прямоугольник" in s:
            a = _number_after(s, r"(?:длин\w*|длина|a)")
            b = _number_after(s, r"(?:ширин\w*|ширина|b)")
            return f"Площадь прямоугольника S = a·b = {a}·{b} = {sp.sstr(a*b)}.\nПериметр P = 2(a+b) = {sp.sstr(2*(a+b))}."
        if "треугольник" in s:
            a = _number_after(s, r"(?:основан\w*|основание|a)")
            h = _number_after(s, r"(?:высот\w*|высота|h)")
            return f"Площадь треугольника S = ah/2 = {a}·{h}/2 = {sp.sstr(a*h/2)} квадратных единиц."
        if "сфер" in s:
            r = _number_after(s, r"(?:радиус|r)")
            return f"Сфера радиуса r={r}:\nV = 4πr³/3 = {sp.sstr(4*sp.pi*r**3/3)}.\nS = 4πr² = {sp.sstr(4*sp.pi*r**2)}."
        if "круг" in s or "окруж" in s:
            r = _number_after(s, r"(?:радиус|r)")
            return f"Площадь круга S = πr² = {sp.sstr(sp.pi*r**2)} ≈ {sp.N(sp.pi*r**2, 8)} квадратных единиц."
        if "квадрат" in s:
            a = _number_after(s, r"(?:сторон\w*|сторона|a)")
            return f"Квадрат со стороной a={a}:\nПериметр P=4a={sp.sstr(4*a)}.\nПлощадь S=a²={sp.sstr(a**2)}."
    except Exception:
        return None
    return None


def solve(raw, grade=7, model="Helio Gen 1 Flash"):
    q = str(raw).strip()
    if not q or len(q) > 300:
        return None
    geometric = _geometry(q)
    if geometric:
        return geometric

    original = q
    q = re.sub(r"(?i)^(реши|вычисли|посчитай|найди|упрости|раскрой скобки)\s*[:,-]?\s*", "", q)
    q = q.replace("×", "*").replace("·", "*").replace("⋅", "*")
    q = q.replace("÷", "/").replace("−", "-").replace("π", "pi").replace("√", "sqrt")
    for sup, exp in (("⁰", "0"), ("¹", "1"), ("²", "2"), ("³", "3"), ("⁴", "4"), ("⁵", "5")):
        q = q.replace(sup, "^" + exp)
    q = re.sub(r"(\d+(?:\.\d+)?)°", r"(\1*pi/180)", q)
    q = re.sub(r"\b(sin|cos|tan|sqrt|log|ln)\s+(\d+(?:\.\d+)?)\b", r"\1(\2)", q, flags=re.I)
    q = q.replace(" ", "")

    # Common school operations: expansion, factorization, derivative and integral.
    try:
        if "=" in q:
            if q.count("=") != 1:
                return "В одном запросе пока решаю одно уравнение. Запиши его в виде выражение = выражение."
            left, right = q.split("=")
            lhs, rhs = _parse(left), _parse(right)
            variables = sorted((lhs-rhs).free_symbols, key=str)
            if not variables:
                return "Равенство верно." if sp.simplify(lhs-rhs) == 0 else "Это равенство неверно."
            var = variables[0]
            polynomial = sp.Poly(lhs-rhs, var) if (lhs-rhs).is_polynomial(var) else None
            answers = sp.solve(sp.Eq(lhs, rhs), var)
            if not answers:
                return f"Для {var} решений не найдено."
            if polynomial is not None and polynomial.degree() == 1:
                return f"Решение уравнения:\n{sp.sstr(lhs)} = {sp.sstr(rhs)}\nПереносим всё в одну сторону и делим на коэффициент при {var}.\n{var} = {sp.sstr(answers[0])}."
            if polynomial is not None and polynomial.degree() == 2:
                disc = sp.discriminant(polynomial.as_expr(), var)
                return f"Квадратное уравнение. Дискриминант D = {sp.sstr(disc)}.\nКорни: " + ", ".join(f"{var} = {sp.sstr(a)}" for a in answers)
            return "Решение: " + ", ".join(f"{var} = {sp.sstr(a)}" for a in answers)

        expr = _parse(q)
        lowered = original.lower()
        if "производн" in lowered or lowered.startswith("diff "):
            var = next(iter(sorted(expr.free_symbols, key=str)), x)
            return f"Производная по {var}:\n" + sp.pretty(sp.diff(expr, var), use_unicode=True)
        if "интеграл" in lowered or lowered.startswith("integrate "):
            var = next(iter(sorted(expr.free_symbols, key=str)), x)
            return f"Первообразная по {var}:\n" + sp.pretty(sp.integrate(expr, var), use_unicode=True) + " + C"
        if "разлож" in lowered or "раскрой" in lowered or "expand " in lowered:
            result = sp.expand(expr)
            return f"Раскрываем скобки:\n{sp.sstr(expr)} = {sp.sstr(result)}"
        if "разложи на множители" in lowered or "factor " in lowered:
            result = sp.factor(expr)
            return f"Разложение на множители:\n{sp.sstr(expr)} = {sp.sstr(result)}"
        result = sp.simplify(expr)
        exact = sp.sstr(result)
        approx = sp.N(result, 10)
        if result.is_number and approx != result:
            return f"{sp.sstr(expr)} = {exact} ≈ {approx}"
        return f"Упрощаем выражение:\n{sp.sstr(expr)} = {exact}"
    except Exception:
        return "Не смог распознать задачу. Можно вводить выражения, степени, корни, sin/cos/tan, уравнения, производные и интегралы. Для геометрии укажи величины словами, например: длина 4, ширина 3, высота 2."
