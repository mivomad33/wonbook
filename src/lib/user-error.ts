// 사용자에게 그대로 보여줄 오류. 서버 액션은 이 오류만 화면에 넘기고, 나머지는 그대로 던진다.
export class UserError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}
