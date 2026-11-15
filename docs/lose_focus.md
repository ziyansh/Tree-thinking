# 失焦判定规则

“失焦” 本质：**当前拥有焦点的对象，不再是它；焦点被转移、回收、销毁。浏览器 / GUI 内核维护一条全局的「当前焦点」，判定就是这条指针的变化。**

下面按前端（最常用），顺带提桌面端、移动端。

## 一、浏览器（DOM）标准判定规则

浏览器内部维护一个：
`document.activeElement` —— 当前拥有焦点的元素。

判定成立的几种场景（任意一条）：

1. 用户点击别的可聚焦元素；
2. Tab / Shift+Tab，键盘把焦点移走；
3. 代码执行 `other.focus()`，抢走焦点；
4. 当前元素被 `hidden`、`disabled`、从 DOM 移除，变成不可聚焦；
5. 焦点跑到 window 之外（切窗口、切 Tab）；
6. 弹窗、dialog、下拉拦截焦点，把焦点挪走。

对应的事件：

- **`blur`**：元素失去焦点；不冒泡；不可取消；`event.relatedTarget` = 拿到焦点的那个元素（有可能 null）W3C
- **`focusout`**：同样是失焦，但是会冒泡；适合在父容器统一监听一堆输入框；顺序：`blur` → `focusout`MDN Web Do...

> 
> 事件顺序（A → B）
> `blur(A)` → `focusout(A)` → `focus(B)` → `focusin(B)`